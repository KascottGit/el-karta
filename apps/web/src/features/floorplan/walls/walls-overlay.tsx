import { add, distance, scale as scaled, type Pt, type Snap, type Wall } from '@el-karta/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Circle, Line, Rect, RegularPolygon } from 'react-konva';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { handle } from '../canvas/hit';
import { ScreenLabel } from '../canvas/screen-label';
import { selectedIds } from '../canvas/selection';
import { canvasColors } from '../canvas/theme';
import { useRenderWindow } from '../canvas/use-render-window';
import { wallColors } from './colors';
import { cornerHandle } from './corner-handle';
import { formatNumber } from './number-format';
import { endKey, jointEnds, wallOutline } from './wall-outline';
import { WallShape } from './walls-layer';
import { useWallsStore } from './walls-store';

const HANDLE_PX = 6;
const MARKER_PX = 6;

/** Everything the walls feature draws above the model: the polyline being drawn, a dragged corner, the snap marker and corner handles. */
export function WallsOverlay({ ctx }: { ctx: CanvasContext }) {
  return (
    <>
      <Draft />
      <DragPreview ctx={ctx} />
      <SnapMarker />
      <CornerHandles ctx={ctx} />
    </>
  );
}

const flat = (points: readonly Pt[]) => points.flatMap((p) => [p.x, p.y]);

function Draft() {
  const { t, i18n } = useTranslation();
  const drawing = useEditorStore((s) => s.drawing);
  const thickness = useWallsStore((s) => s.thickness);
  const labelScale = useRenderWindow().scale;
  const points = useMemo(
    () => (drawing ? (drawing.hover ? [...drawing.points, drawing.hover] : drawing.points) : []),
    [drawing],
  );
  const outlines = useMemo(
    () =>
      points.slice(1).map((b, i) => {
        const wall: Wall = {
          id: String(i),
          a: points[i]!,
          b,
          thickness,
          provenance: { status: 'manual' },
        };
        return wallOutline(wall, i > 0, i < points.length - 2);
      }),
    [points, thickness],
  );
  if (points.length === 0) return null;
  const a = points.at(-2);
  const b = points.at(-1)!;
  const length = a ? distance(a, b) : 0;
  return (
    <>
      {outlines.map((outline, i) => (
        <Line
          key={i}
          points={outline}
          closed
          fill={wallColors.draft}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
      <Line
        points={flat(points)}
        stroke={wallColors.draftLine}
        strokeWidth={1}
        strokeScaleEnabled={false}
        listening={false}
      />
      {a && length > 0 && (
        <ScreenLabel
          text={t('walls.lengthLabel', { length: formatNumber(length, i18n.language, 2) })}
          at={scaled(add(a, b), 0.5)}
          maxWidth={Math.max(length, 120 / labelScale)}
          scale={labelScale}
          fill={wallColors.draftLine}
        />
      )}
    </>
  );
}

function DragPreview({ ctx }: { ctx: CanvasContext }) {
  const drag = useWallsStore((s) => (s.drag?.floorId === ctx.floorId ? s.drag : null));
  const walls = useModelStore((s) => s.model?.floors[ctx.floorId]?.data.walls);
  if (!drag || !walls) return null;
  const joints = jointEnds(walls);
  const moved = new Set(drag.ends.map((e) => endKey(e.wallId, e.end)));
  const corner = drag.ends.length > 1;
  return drag.preview.map((wall) => (
    <WallShape
      key={wall.id}
      wall={wall}
      capA={moved.has(endKey(wall.id, 'a')) ? corner : joints.has(endKey(wall.id, 'a'))}
      capB={moved.has(endKey(wall.id, 'b')) ? corner : joints.has(endKey(wall.id, 'b'))}
      color={canvasColors.selected}
      listening={false}
    />
  ));
}

function SnapMarker() {
  const snap = useWallsStore((s) => s.snap);
  const scale = useEditorStore((s) => s.viewport.scale);
  if (!snap || snap.kind === 'none') return null;
  return <Marker snap={snap} r={MARKER_PX / scale} />;
}

function Marker({ snap, r }: { snap: Snap; r: number }) {
  const { x, y } = snap.point;
  const common = {
    stroke: wallColors.snap,
    strokeWidth: 2,
    strokeScaleEnabled: false,
    listening: false,
  } as const;
  return (
    <>
      {snap.targets.map((target, i) =>
        target.kind === 'angle' ? (
          <Line
            key={i}
            points={flat([target.from, snap.point])}
            {...common}
            strokeWidth={1}
            dash={[4, 4]}
          />
        ) : null,
      )}
      {snap.kind === 'endpoint' ? (
        <Rect x={x - r} y={y - r} width={2 * r} height={2 * r} {...common} />
      ) : snap.kind === 'midpoint' ? (
        <RegularPolygon x={x} y={y} sides={3} radius={1.3 * r} {...common} />
      ) : (
        <Circle x={x} y={y} radius={r} {...common} />
      )}
      {snap.targets.length > 1 && (
        <Line points={[x - r, y - r, x + r, y + r]} {...common} strokeWidth={1.5} />
      )}
      {snap.targets.length > 1 && (
        <Line points={[x - r, y + r, x + r, y - r]} {...common} strokeWidth={1.5} />
      )}
    </>
  );
}

/** Draggable ends of the selected walls; dragging one moves the whole corner. */
function CornerHandles({ ctx }: { ctx: CanvasContext }) {
  const walls = useModelStore((s) => s.model?.floors[ctx.floorId]?.data.walls);
  const selection = useEditorStore((s) => s.selection);
  const scale = useEditorStore((s) => s.viewport.scale);
  const dragging = useWallsStore((s) => s.drag !== null);
  const ends = useMemo(() => {
    if (!walls || dragging) return [];
    const seen = new Set<string>();
    return [...selectedIds(selection, 'walls')].flatMap((id) => {
      const wall = walls[id];
      if (!wall) return [];
      return (['a', 'b'] as const).flatMap((end) => {
        const key = `${wall[end].x},${wall[end].y}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ wallId: wall.id, end, at: wall[end] }];
      });
    });
  }, [walls, selection, dragging]);
  return ends.map(({ wallId, end, at }) => (
    <Circle
      key={endKey(wallId, end)}
      {...handle(cornerHandle, { wallId, end })}
      x={at.x}
      y={at.y}
      radius={HANDLE_PX / scale}
      fill={wallColors.handle}
      stroke={canvasColors.selected}
      strokeWidth={2}
      strokeScaleEnabled={false}
    />
  ));
}
