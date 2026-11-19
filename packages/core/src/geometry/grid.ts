import type { Grid, GridLine, Pt } from '../schemas/index.ts';
import { EPSILON } from './vec.ts';

/**
 * Which set of grid lines (axes on a drawing):
 * - `x`: `grid.xLines`, vertical lines at x = pos, lettered A, B, C … left to right, then Z, AA, AB ….
 * - `y`: `grid.yLines`, horizontal lines at y = pos, numbered 1, 2, 3 … top to bottom (y is down).
 *
 * Drawings differ on which direction gets letters (US practice numbers the vertical lines); labels
 * are free text, so a plan with the other convention keeps its own labels. A location is named
 * letter first, e.g. "C4".
 *
 * Functions here take lines in any order and return them sorted by `pos`; a line's index is its
 * index in that order.
 */
export type GridAxis = 'x' | 'y';

const key = (axis: GridAxis) => (axis === 'x' ? 'xLines' : 'yLines');

export const gridLines = (grid: Grid, axis: GridAxis): readonly GridLine[] => grid[key(axis)];

/** The automatic label of the line at `index` (from 0) on an axis: A … Z, AA, AB … or 1, 2, 3 …. */
export function autoLabel(axis: GridAxis, index: number): string {
  if (axis === 'y') return String(index + 1);
  let label = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  }
  return label;
}

export const sortLines = (lines: readonly GridLine[]): GridLine[] =>
  [...lines].sort((a, b) => a.pos - b.pos);

/**
 * Whether an axis still carries the automatic labels in position order. Such an axis is relabelled
 * whenever lines are added, removed or moved; one with any label of its own is never relabelled
 * except by `relabelGrid`.
 */
export const isAutoLabelled = (axis: GridAxis, lines: readonly GridLine[]): boolean =>
  sortLines(lines).every((line, i) => line.label === autoLabel(axis, i));

const relabelled = (axis: GridAxis, lines: readonly GridLine[]): GridLine[] =>
  sortLines(lines).map((line, i) => ({ ...line, label: autoLabel(axis, i) }));

/** Gives one axis, or both, the automatic labels. */
export function relabelGrid(grid: Grid, axis?: GridAxis): Grid {
  return {
    xLines: axis === 'y' ? sortLines(grid.xLines) : relabelled('x', grid.xLines),
    yLines: axis === 'x' ? sortLines(grid.yLines) : relabelled('y', grid.yLines),
  };
}

function changeAxis(grid: Grid, axis: GridAxis, change: (lines: GridLine[]) => GridLine[]): Grid {
  const before = gridLines(grid, axis);
  const after = sortLines(change(sortLines(before)));
  return { ...grid, [key(axis)]: isAutoLabelled(axis, before) ? relabelled(axis, after) : after };
}

/** `count` lines `spacing` apart from `start`, labelled automatically. */
export function evenLines(
  axis: GridAxis,
  start: number,
  count: number,
  spacing: number,
): GridLine[] {
  return Array.from({ length: count }, (_, i) => ({
    label: autoLabel(axis, i),
    pos: start + i * spacing,
  }));
}

/** An evenly spaced grid whose first lines (A and 1) cross at `origin`. */
export function evenGrid(input: {
  origin: Pt;
  x: { count: number; spacing: number };
  y: { count: number; spacing: number };
}): Grid {
  return {
    xLines: evenLines('x', input.origin.x, input.x.count, input.x.spacing),
    yLines: evenLines('y', input.origin.y, input.y.count, input.y.spacing),
  };
}

/**
 * Adds a line at `pos`. On an automatically labelled axis every line is relabelled; otherwise the new
 * line gets the first automatic label not used on the axis.
 */
export function addGridLine(grid: Grid, axis: GridAxis, pos: number): Grid {
  const used = new Set(gridLines(grid, axis).map((line) => line.label));
  let i = 0;
  while (used.has(autoLabel(axis, i))) i++;
  return changeAxis(grid, axis, (lines) => [...lines, { label: autoLabel(axis, i), pos }]);
}

export function removeGridLine(grid: Grid, axis: GridAxis, index: number): Grid {
  return changeAxis(grid, axis, (lines) => lines.filter((_, i) => i !== index));
}

/** Moves a line, keeping the axis sorted; it may pass its neighbours. */
export function moveGridLine(grid: Grid, axis: GridAxis, index: number, pos: number): Grid {
  return changeAxis(grid, axis, (lines) =>
    lines.map((line, i) => (i === index ? { ...line, pos } : line)),
  );
}

/** Sets a line's label; a blank label leaves the grid unchanged, since labels are required. */
export function renameGridLine(grid: Grid, axis: GridAxis, index: number, label: string): Grid {
  const trimmed = label.trim();
  if (!trimmed) return grid;
  return {
    ...grid,
    [key(axis)]: sortLines(gridLines(grid, axis)).map((line, i) =>
      i === index ? { ...line, label: trimmed } : line,
    ),
  };
}

/**
 * The line that names coordinate `v` on one axis: the nearest one, the lower one at a midpoint.
 * Beyond the outermost lines the grid reaches half the outer spacing, as far as the inner lines
 * reach; past that, null. A lone line has no spacing to measure by and names every coordinate.
 */
export function nearestGridLine(lines: readonly GridLine[], v: number): GridLine | null {
  const sorted = sortLines(lines);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return null;
  if (sorted.length === 1) return first;
  const firstReach = (sorted[1]!.pos - first.pos) / 2;
  const lastReach = (last.pos - sorted.at(-2)!.pos) / 2;
  if (v < first.pos - firstReach - EPSILON || v > last.pos + lastReach + EPSILON) return null;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (v <= (sorted[i]!.pos + sorted[i + 1]!.pos) / 2 + EPSILON) return sorted[i]!;
  }
  return last;
}

/**
 * The grid location of a point, letter first, named by the nearest grid intersection: the nearest
 * line on each axis (see `nearestGridLine`). A point between C and D and between 3 and 4 is "C3",
 * "D3", "C4" or "D4", whichever crossing is closest. An axis without lines adds nothing to the
 * name ("C" for a grid of only x lines). Null when the grid is empty or the point is outside it.
 */
export function gridCell(grid: Grid, point: Pt): string | null {
  if (grid.xLines.length === 0 && grid.yLines.length === 0) return null;
  let name = '';
  for (const [lines, v] of [
    [grid.xLines, point.x],
    [grid.yLines, point.y],
  ] as const) {
    if (lines.length === 0) continue;
    const line = nearestGridLine(lines, v);
    if (!line) return null;
    name += line.label;
  }
  return name;
}
