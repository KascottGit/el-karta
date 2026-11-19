import type { Pt } from '../schemas/index.ts';
import { add, cross, distance, dot, EPSILON, scale, sub } from './vec.ts';

export function signedArea(polygon: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

export function centroid(polygon: readonly Pt[]): Pt {
  const area = signedArea(polygon);
  if (Math.abs(area) < EPSILON) {
    const n = polygon.length || 1;
    return {
      x: polygon.reduce((s, p) => s + p.x, 0) / n,
      y: polygon.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

export function pointInPolygon(point: Pt, polygon: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsIntersect(p1: Pt, p2: Pt, q1: Pt, q2: Pt): boolean {
  const d1 = cross(sub(q2, q1), sub(p1, q1));
  const d2 = cross(sub(q2, q1), sub(p2, q1));
  const d3 = cross(sub(p2, p1), sub(q1, p1));
  const d4 = cross(sub(p2, p1), sub(q2, p1));
  return d1 * d2 < -EPSILON && d3 * d4 < -EPSILON;
}

export type PolygonProblem =
  'too-few-points' | 'repeated-point' | 'zero-area' | 'self-intersecting';

/** Polygons are stored open: the last point implicitly connects back to the first. */
export function polygonProblem(polygon: readonly Pt[]): PolygonProblem | null {
  if (polygon.length < 3) return 'too-few-points';
  for (let i = 0; i < polygon.length; i++) {
    if (distance(polygon[i]!, polygon[(i + 1) % polygon.length]!) < EPSILON)
      return 'repeated-point';
  }
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(polygon[i]!, polygon[i + 1]!, polygon[j]!, polygon[(j + 1) % n]!)) {
        return 'self-intersecting';
      }
    }
  }
  if (Math.abs(signedArea(polygon)) < EPSILON) return 'zero-area';
  return null;
}

/** The point on segment a–b nearest to `p`, and its parameter `t` from 0 at `a` to 1 at `b`. */
export function closestOnSegment(p: Pt, a: Pt, b: Pt): { point: Pt; t: number } {
  const ab = sub(b, a);
  const lengthSquared = dot(ab, ab);
  const t =
    lengthSquared < EPSILON ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / lengthSquared));
  return { point: add(a, scale(ab, t)), t };
}

export const moveVertex = (polygon: readonly Pt[], index: number, to: Pt): Pt[] =>
  polygon.map((p, i) => (i === index ? to : p));

/** Inserts `p` between vertex `index` and the next one (wrapping around to the first). */
export const insertVertex = (polygon: readonly Pt[], index: number, p: Pt): Pt[] => [
  ...polygon.slice(0, index + 1),
  p,
  ...polygon.slice(index + 1),
];

/** Null when the polygon would be left with fewer than three vertices. */
export const removeVertex = (polygon: readonly Pt[], index: number): Pt[] | null =>
  polygon.length <= 3 ? null : polygon.filter((_, i) => i !== index);

/**
 * Drops repeated points and vertices that lie on the straight line through their neighbours, such
 * as where a wall meets a room's side in a T.
 */
export function withoutCollinear(polygon: readonly Pt[], tolerance = 1e-6): Pt[] {
  let points = [...polygon];
  for (let changed = true; changed && points.length > 3;) {
    changed = false;
    for (let i = 0; i < points.length && points.length > 3; i++) {
      const prev = points[(i - 1 + points.length) % points.length]!;
      const p = points[i]!;
      const next = points[(i + 1) % points.length]!;
      const span = distance(prev, next);
      const straight =
        distance(prev, p) < tolerance ||
        (span > tolerance &&
          Math.abs(cross(sub(next, prev), sub(p, prev))) / span < tolerance &&
          dot(sub(p, prev), sub(next, p)) >= 0);
      if (straight) {
        points = points.filter((_, j) => j !== i);
        changed = true;
        i--;
      }
    }
  }
  return points;
}

/** The same outline: equal corners in the same cyclic order, from any start and in either direction. */
export function samePolygon(a: readonly Pt[], b: readonly Pt[], tolerance = 1e-6): boolean {
  const n = a.length;
  if (n !== b.length) return false;
  if (n === 0) return true;
  for (let start = 0; start < n; start++) {
    for (const step of [1, -1]) {
      let same = true;
      for (let i = 0; i < n && same; i++) {
        same = distance(a[i]!, b[(start + step * i + n * 2) % n]!) <= tolerance;
      }
      if (same) return true;
    }
  }
  return false;
}
