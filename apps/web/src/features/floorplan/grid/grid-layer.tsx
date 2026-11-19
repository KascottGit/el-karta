import { gridLines, sortLines, type GridAxis, type GridLine } from '@el-karta/core';
import { memo, useMemo } from 'react';
import { Circle, Line } from 'react-konva';
import { useStore } from 'zustand';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { handle } from '../canvas/hit';
import type { Rect } from '../canvas/rect';
import { ScreenLabel } from '../canvas/screen-label';
import { canvasColors } from '../canvas/theme';
import { useRenderWindow } from '../canvas/use-render-window';
import { GRID_TOOL, gridLineHandle, gridUiStore } from './interaction';
import { useGridGeometry } from './use-grid-geometry';

const gridColors = { line: '#94a3b8', label: '#334155', bubble: '#ffffff' } as const;

/** How far lines reach past the floor's content before their label bubbles. */
const OVERHANG_PX = 24;
const BUBBLE_RADIUS_PX = 11;
const LABEL_WIDTH_PX = 40;
const DASH_PX = [14, 4, 3, 4];

const AXES: readonly GridAxis[] = ['x', 'y'];

/** Grid lines across the floor with label bubbles at both ends; draggable while the grid tool is active. */
export function GridLayer({ ctx }: { ctx: CanvasContext }) {
  const { grid, extent } = useGridGeometry(ctx.floorId);
  const { scale } = useRenderWindow();
  const editable = useEditorStore((s) => s.tool === GRID_TOOL);
  const dragged = useStore(gridUiStore, (s) => s.drag && `${s.drag.axis}${s.drag.index}`);
  const lines = useMemo(
    () => (grid ? AXES.map((axis) => ({ axis, lines: sortLines(gridLines(grid, axis)) })) : []),
    [grid],
  );
  if (!extent) return null;
  return lines.flatMap(({ axis, lines }) =>
    lines.map((line, index) => (
      <GridLineShape
        key={`${axis}${index}`}
        axis={axis}
        index={index}
        line={line}
        extent={extent}
        scale={scale}
        editable={editable}
        faded={dragged === `${axis}${index}`}
      />
    )),
  );
}

/** The line being dragged, at its new position. */
export function GridLineDraft({ ctx }: { ctx: CanvasContext }) {
  const { extent } = useGridGeometry(ctx.floorId);
  const { scale } = useRenderWindow();
  const drag = useStore(gridUiStore, (s) => s.drag);
  const label = useModelStore((s) => {
    const grid = s.model?.floors[ctx.floorId]?.data.grid;
    return drag && grid && sortLines(gridLines(grid, drag.axis))[drag.index]?.label;
  });
  const line = useMemo(() => drag && label && { label, pos: drag.pos }, [drag, label]);
  if (!drag || !line || !extent) return null;
  return (
    <GridLineShape
      axis={drag.axis}
      index={drag.index}
      line={line}
      extent={extent}
      scale={scale}
      editable={false}
      color={canvasColors.selected}
    />
  );
}

const GridLineShape = memo(function GridLineShape({
  axis,
  index,
  line,
  extent,
  scale,
  editable,
  faded = false,
  color,
}: {
  axis: GridAxis;
  index: number;
  line: GridLine;
  extent: Rect;
  scale: number;
  editable: boolean;
  faded?: boolean;
  color?: string;
}) {
  const over = OVERHANG_PX / scale;
  const radius = Math.max(BUBBLE_RADIUS_PX, 4 + 3.5 * line.label.length) / scale;
  const [lo, hi] = axis === 'x' ? [extent.minY, extent.maxY] : [extent.minX, extent.maxX];
  const at = (along: number) =>
    axis === 'x' ? { x: line.pos, y: along } : { x: along, y: line.pos };
  const start = at(lo - over);
  const end = at(hi + over);
  return (
    <>
      <Line
        points={[start.x, start.y, end.x, end.y]}
        stroke={color ?? gridColors.line}
        strokeWidth={1}
        dash={DASH_PX}
        strokeScaleEnabled={false}
        opacity={faded ? 0.4 : 1}
        listening={false}
        perfectDrawEnabled={false}
      />
      {[at(lo - over - radius), at(hi + over + radius)].map((center, i) => (
        <Bubble
          key={i}
          center={center}
          radius={radius}
          label={line.label}
          scale={scale}
          color={color}
          faded={faded}
          handleProps={editable ? handle(gridLineHandle, { axis, index, from: line.pos }) : null}
        />
      ))}
    </>
  );
});

function Bubble({
  center,
  radius,
  label,
  scale,
  color,
  faded,
  handleProps,
}: {
  center: { x: number; y: number };
  radius: number;
  label: string;
  scale: number;
  color: string | undefined;
  faded: boolean;
  handleProps: ReturnType<typeof handle> | null;
}) {
  return (
    <>
      <Circle
        {...handleProps}
        listening={handleProps !== null}
        x={center.x}
        y={center.y}
        radius={radius}
        fill={gridColors.bubble}
        stroke={color ?? gridColors.line}
        strokeWidth={handleProps ? 2 : 1}
        strokeScaleEnabled={false}
        opacity={faded ? 0.4 : 1}
        perfectDrawEnabled={false}
      />
      <ScreenLabel
        text={label}
        at={center}
        maxWidth={Math.max(LABEL_WIDTH_PX / scale, 2 * radius)}
        scale={scale}
        fontSize={11}
        fill={color ?? gridColors.label}
      />
    </>
  );
}
