import type { FloorData, Grid, Pt } from '@el-karta/core';
import { boundsOf, height, width, type Rect } from '../canvas/rect';

/** The area the floor's walls, rooms and zones cover. */
export function contentBounds(data: Pick<FloorData, 'walls' | 'rooms' | 'zones'>): Rect | null {
  const points: Pt[] = [];
  for (const wall of Object.values(data.walls)) points.push(wall.a, wall.b);
  for (const area of [...Object.values(data.rooms), ...Object.values(data.zones)]) {
    for (const p of area.polygon) points.push(p);
  }
  return boundsOf(points);
}

type Range = readonly [number, number];

const span = (values: readonly number[], around: Range | null): Range | null => {
  if (values.length === 0) return around;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return around ? [Math.min(lo, around[0]), Math.max(hi, around[1])] : [lo, hi];
};

/**
 * The area grid lines span: their own positions and `content`. An axis that has neither lines nor
 * content borrows the other axis's range, so a grid of only x lines on an empty floor is still drawn.
 */
export function gridExtent(grid: Grid, content: Rect | null): Rect | null {
  if (grid.xLines.length === 0 && grid.yLines.length === 0) return null;
  const xs = span(
    grid.xLines.map((l) => l.pos),
    content && [content.minX, content.maxX],
  );
  const ys = span(
    grid.yLines.map((l) => l.pos),
    content && [content.minY, content.maxY],
  );
  const x = xs ?? ys;
  const y = ys ?? xs;
  if (!x || !y) return null;
  return { minX: x[0], maxX: x[1], minY: y[0], maxY: y[1] };
}

const FIT_MARGIN = 0.06;

/**
 * The grid's extent with a margin of 6% of its larger side, for zoom to fit. The label bubbles sit a
 * fixed number of pixels outside the extent, beyond the fit's padding; at a fitted zoom this margin
 * is a roughly constant number of pixels, which makes room for them.
 */
export function gridFitBounds(grid: Grid, content: Rect | null): Rect | null {
  const r = gridExtent(grid, content);
  if (!r) return null;
  const m = FIT_MARGIN * Math.max(width(r), height(r));
  return { minX: r.minX - m, minY: r.minY - m, maxX: r.maxX + m, maxY: r.maxY + m };
}
