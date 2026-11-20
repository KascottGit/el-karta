import type { Pt } from '@el-karta/core';

/** An axis-aligned rectangle in whatever space its points come from (world metres or screen pixels). */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: readonly Pt[], pad = 0): Rect | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export const intersects = (a: Rect, b: Rect): boolean =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

export const contains = (outer: Rect, inner: Rect): boolean =>
  outer.minX <= inner.minX &&
  outer.minY <= inner.minY &&
  outer.maxX >= inner.maxX &&
  outer.maxY >= inner.maxY;

export const width = (r: Rect): number => r.maxX - r.minX;
export const height = (r: Rect): number => r.maxY - r.minY;

/** Grows the rectangle by `fraction` of its own size on every side. */
export function expand(r: Rect, fraction: number): Rect {
  const dx = width(r) * fraction;
  const dy = height(r) * fraction;
  return { minX: r.minX - dx, minY: r.minY - dy, maxX: r.maxX + dx, maxY: r.maxY + dy };
}

export function union(rects: Iterable<Rect | null>): Rect | null {
  let out: Rect | null = null;
  for (const r of rects) {
    if (!r) continue;
    out = out
      ? {
          minX: Math.min(out.minX, r.minX),
          minY: Math.min(out.minY, r.minY),
          maxX: Math.max(out.maxX, r.maxX),
          maxY: Math.max(out.maxY, r.maxY),
        }
      : r;
  }
  return out;
}
