import type { Pt } from '../schemas/index.ts';
import { cross, distance, EPSILON, sub } from './vec.ts';

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
