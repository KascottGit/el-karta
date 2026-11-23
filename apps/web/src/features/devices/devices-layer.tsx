import { worstSeverity } from '@/features/floorplan/validation/severity';
import type { Id, Pt } from '@el-karta/core';
import type Konva from 'konva';
import { memo, useMemo } from 'react';
import { Line, Shape } from 'react-konva';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '@/features/floorplan/editor-store';
import { createCuller } from '@/features/floorplan/canvas/culling';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { selectable } from '@/features/floorplan/canvas/hit';
import { selectedIds } from '@/features/floorplan/canvas/selection';
import { canvasColors, issueColors } from '@/features/floorplan/canvas/theme';
import { useRenderWindow } from '@/features/floorplan/canvas/use-render-window';
import { deviceAppearance, type MarkerShape } from './appearance';
import { deviceIssues, type DeviceIssue } from './device-issues';
import { deviceMarks, markBounds, type DeviceMark } from './device-marks';
import { markerSubpath } from './marker-path';
import { markerSprite, type MarkerStyle } from './marker-sprites';

const cullMarks = createCuller(markBounds);
const NO_MARKS: readonly DeviceMark[] = [];
const NO_ISSUES: ReadonlyMap<Id, readonly DeviceIssue[]> = new Map();
const MARKER_PX = 7;
const SELECTED_MARKER_PX = 9;
const OUTLINE = '#ffffff';
const OUTLINE_PX = 1.5;
const SELECTED_OUTLINE_PX = 2.5;
const FOOTPRINT_ALPHA = 0.25;
// Any colour: hit shapes are drawn in their hit colour, never on screen.
const HIT_FILL = '#000000';

/** Markers that look the same, so one sprite paints them all. */
interface MarkerGroup {
  style: MarkerStyle;
  at: Pt[];
}

/**
 * Every device with a position as a small marker of constant screen size, and devices drawn at
 * their own size as their footprint. Flagged devices take the colour of their worst issue.
 *
 * One shape paints all markers from cached sprites, since a shape and path per marker made
 * panning the large project about three times slower; each device has a hit-only shape for
 * selection.
 */
export function DevicesLayer({ ctx }: { ctx: CanvasContext }) {
  const floor = useModelStore((s) => s.model?.floors[ctx.floorId]);
  const data = floor?.data;
  const { rect: view } = useRenderWindow();
  const selection = useEditorStore((s) => s.selection);
  const marks = useMemo(() => (data ? deviceMarks(data) : undefined), [data]);
  const issues = useMemo(() => (floor ? deviceIssues(floor) : NO_ISSUES), [floor]);
  const visible = useMemo(() => (marks ? cullMarks(marks, view) : NO_MARKS), [marks, view]);
  const selected = useMemo(() => selectedIds(selection, 'devices'), [selection]);

  const colorOf = useMemo(
    () => (mark: DeviceMark) => {
      const severity = worstSeverity(issues.get(mark.device.id));
      return severity ? issueColors[severity] : deviceAppearance(mark.device).color;
    },
    [issues],
  );

  const groups = useMemo(() => {
    const byKey = new Map<string, MarkerGroup>();
    const add = (mark: DeviceMark, look: 'plain' | 'selected') => {
      const shape = deviceAppearance(mark.device).shape;
      const fill = colorOf(mark);
      const key = `${look}|${shape}|${fill}`;
      const group = byKey.get(key);
      if (group) group.at.push(mark.at);
      else byKey.set(key, { style: markerStyle(shape, fill, look), at: [mark.at] });
    };
    const chosen: DeviceMark[] = [];
    for (const mark of visible) {
      if (mark.footprint) continue;
      if (selected.has(mark.device.id)) chosen.push(mark);
      else add(mark, 'plain');
    }
    // Selected markers come last, so they are drawn on top.
    for (const mark of chosen) add(mark, 'selected');
    return [...byKey.values()];
  }, [visible, selected, colorOf]);

  // Memoized like `WallsLayer`'s, for the urgent render after a render window change.
  return useMemo(
    () => (
      <>
        {visible.map((mark) =>
          mark.footprint ? (
            <Footprint
              key={mark.device.id}
              id={mark.device.id}
              corners={mark.footprint}
              color={colorOf(mark)}
              selected={selected.has(mark.device.id)}
            />
          ) : null,
        )}
        <Markers groups={groups} />
        {visible.map((mark) =>
          mark.footprint ? null : (
            <MarkerHit
              key={mark.device.id}
              id={mark.device.id}
              at={mark.at}
              shape={deviceAppearance(mark.device).shape}
            />
          ),
        )}
      </>
    ),
    [visible, selected, colorOf, groups],
  );
}

const markerStyle = (shape: MarkerShape, fill: string, look: 'plain' | 'selected'): MarkerStyle =>
  look === 'plain'
    ? { shape, fill, stroke: OUTLINE, radiusPx: MARKER_PX, lineWidthPx: OUTLINE_PX }
    : {
        shape,
        fill,
        stroke: canvasColors.selected,
        radiusPx: SELECTED_MARKER_PX,
        lineWidthPx: SELECTED_OUTLINE_PX,
      };

/** Paints every visible marker. It reads the zoom when it is drawn, so zooming never re-renders it. */
const Markers = memo(function Markers({ groups }: { groups: readonly MarkerGroup[] }) {
  const sceneFunc = useMemo(
    () => (context: Konva.Context, node: Konva.Shape) => {
      const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = node.getAbsoluteTransform().getMatrix();
      const ratio = context.getCanvas().getPixelRatio();
      // Sprites are copied in device pixels, one to one, so they stay sharp.
      context.setTransform(1, 0, 0, 1, 0, 0);
      for (const { style, at } of groups) {
        const sprite = markerSprite(style, ratio);
        const half = sprite.width / 2;
        for (const { x, y } of at) {
          const px = (a * x + c * y + e) * ratio;
          const py = (b * x + d * y + f) * ratio;
          context.drawImage(sprite, Math.round(px - half), Math.round(py - half));
        }
      }
    },
    [groups],
  );
  return <Shape sceneFunc={sceneFunc} listening={false} perfectDrawEnabled={false} />;
});

/**
 * Where a marker can be tapped. Without a scene function it is drawn only into the hit graph,
 * which is redrawn only when something is hit-tested.
 */
const MarkerHit = memo(function MarkerHit({
  id,
  at,
  shape,
}: {
  id: Id;
  at: Pt;
  shape: MarkerShape;
}) {
  const hitFunc = useMemo(
    () => (context: Konva.Context, node: Konva.Shape) => {
      context.beginPath();
      markerSubpath(context, shape, 0, 0, SELECTED_MARKER_PX / node.getAbsoluteScale().x);
      context.fillShape(node);
    },
    [shape],
  );
  return (
    <Shape
      {...selectable('devices', id)}
      x={at.x}
      y={at.y}
      hitFunc={hitFunc}
      fill={HIT_FILL}
      perfectDrawEnabled={false}
    />
  );
});

const Footprint = memo(function Footprint({
  id,
  corners,
  color,
  selected,
}: {
  id: Id;
  corners: readonly Pt[];
  color: string;
  selected: boolean;
}) {
  const points = useMemo(() => corners.flatMap((p) => [p.x, p.y]), [corners]);
  return (
    <Line
      {...selectable('devices', id)}
      points={points}
      closed
      fill={withAlpha(selected ? canvasColors.selected : color, FOOTPRINT_ALPHA)}
      stroke={selected ? canvasColors.selected : color}
      strokeWidth={selected ? SELECTED_OUTLINE_PX : OUTLINE_PX}
      strokeScaleEnabled={false}
      perfectDrawEnabled={false}
    />
  );
});

/** `#rrggbb` with an alpha channel, so a footprint's fill is translucent but its outline is not. */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}
