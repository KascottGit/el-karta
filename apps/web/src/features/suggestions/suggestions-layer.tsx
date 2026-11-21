import { add, leftNormal, scale, sub, type Pt } from '@el-karta/core';
import type Konva from 'konva';
import { memo, useEffect, useMemo } from 'react';
import { Line, Shape } from 'react-konva';
import { labelPlacement } from '@/features/floorplan/areas/bounds';
import { createCuller } from '@/features/floorplan/canvas/culling';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { ScreenLabel } from '@/features/floorplan/canvas/screen-label';
import { suggestionStyle } from '@/features/floorplan/canvas/theme';
import { useRenderWindow } from '@/features/floorplan/canvas/use-render-window';
import { useModelStore } from '@/model/store';
import { isPending, suggestionKinds } from './actions';
import { createGhostBuilder, ghostBounds, type Ghost } from './ghosts';
import { ghostColor, withAlpha } from './ghost-style';
import { useFloorSuggestions } from './hooks';
import { onFloor, publishGhosts, useSuggestions } from './suggestions-store';

const cullGhosts = createCuller(ghostBounds);
const NO_WALLS = {};
const AREA_FILL_ALPHA = 0.12;
const MIN_LINE_PX = 3;
/** How far an opening's end ticks reach past its wall's faces. */
const OVERHANG_PX = 4;
// The canvas background, as the model's openings cut their walls (`openings/opening-shape.tsx`).
const GAP = '#ffffff';

const ORDER: Readonly<Record<Ghost['shape']['role'], number>> = { area: 0, wall: 1, opening: 2 };

/**
 * The pending suggestions of the floor, ghosted: dashed, translucent and coloured by confidence or
 * issue (`suggestionStyle`). They are not model items, so validation never sees them, and they do
 * not listen for hits; the suggestions tool hit-tests them itself.
 */
export function SuggestionsLayer({ ctx }: { ctx: CanvasContext }) {
  const { suggestions } = useFloorSuggestions(ctx.floorId);
  const walls = useModelStore((s) => s.model?.floors[ctx.floorId]?.data.walls) ?? NO_WALLS;
  const build = useMemo(() => createGhostBuilder(suggestionKinds), []);
  const ghosts = useMemo(() => build(suggestions, walls), [build, suggestions, walls]);
  const pending = useMemo(() => suggestions.filter(isPending).length, [suggestions]);
  useEffect(() => {
    publishGhosts(ctx.floorId, ghosts, pending);
  }, [ctx.floorId, ghosts, pending]);

  const { rect: view } = useRenderWindow();
  const visible = useMemo(
    () => [...cullGhosts(ghosts, view)].sort((a, b) => ORDER[a.shape.role] - ORDER[b.shape.role]),
    [ghosts, view],
  );
  const selected = useSuggestions((s) => onFloor(s.selected, ctx.floorId));

  return useMemo(
    () => (
      <>
        {visible.map((ghost) => (
          <GhostNode
            key={ghost.suggestion.id}
            ghost={ghost}
            selected={ghost.suggestion.id === selected}
          />
        ))}
      </>
    ),
    [visible, selected],
  );
}

function stroke(context: Konva.Context, a: Pt, b: Pt, width: number, color: string) {
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.setAttr('lineWidth', width);
  context.setAttr('strokeStyle', color);
  context.stroke();
}

/**
 * A wall as a dashed band of its thickness. An opening as a gap over its wall's band, with ticks
 * at its ends and a dashed centre line, so it reads as a door or window rather than more wall.
 */
const drawLine =
  (shape: Extract<Ghost['shape'], { type: 'line' }>, color: string) =>
  (context: Konva.Context, node: Konva.Shape) => {
    const px = 1 / node.getAbsoluteScale().x;
    const dash = suggestionStyle.dash.map((d) => d * px);
    context.setAttr('lineCap', 'butt');
    if (shape.role === 'wall') {
      context.setLineDash(dash);
      stroke(context, shape.a, shape.b, Math.max(shape.thickness, MIN_LINE_PX * px), color);
      return;
    }
    const normal = scale(leftNormal(sub(shape.b, shape.a)), shape.thickness / 2 + OVERHANG_PX * px);
    context.setLineDash([]);
    stroke(context, shape.a, shape.b, shape.thickness + 2 * px, GAP);
    for (const end of [shape.a, shape.b]) {
      stroke(context, add(end, normal), sub(end, normal), 2 * px, color);
    }
    context.setLineDash(dash);
    stroke(context, shape.a, shape.b, 2 * px, color);
  };

const GhostNode = memo(function GhostNode({
  ghost,
  selected,
}: {
  ghost: Ghost;
  selected: boolean;
}) {
  const { shape, suggestion, severity } = ghost;
  const color = ghostColor(suggestion.confidence, severity, selected);
  const opacity = selected ? 1 : suggestionStyle.opacity;
  const sceneFunc = useMemo(
    () => (shape.type === 'line' ? drawLine(shape, color) : null),
    [shape, color],
  );
  const points = useMemo(
    () => (shape.type === 'area' ? shape.polygon.flatMap((p) => [p.x, p.y]) : []),
    [shape],
  );
  const label = useMemo(
    () => (shape.type === 'area' ? labelPlacement(shape.polygon) : null),
    [shape],
  );

  if (sceneFunc) {
    return (
      <Shape sceneFunc={sceneFunc} opacity={opacity} listening={false} perfectDrawEnabled={false} />
    );
  }
  if (shape.type !== 'area' || !label) return null;
  return (
    <>
      <Line
        points={points}
        closed
        fill={withAlpha(color, AREA_FILL_ALPHA)}
        stroke={color}
        strokeWidth={2}
        dash={[...suggestionStyle.dash]}
        strokeScaleEnabled={false}
        opacity={opacity}
        listening={false}
        perfectDrawEnabled={false}
      />
      {shape.label && (
        <ScreenLabel text={shape.label} at={label.at} maxWidth={label.width} fill={color} />
      )}
    </>
  );
});
