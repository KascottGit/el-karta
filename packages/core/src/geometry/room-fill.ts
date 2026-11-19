import type { Id, Pt, Wall } from '../schemas/index.ts';
import { closestOnSegment, pointInPolygon, signedArea, withoutCollinear } from './polygon.ts';
import { add, cross, distance, EPSILON, scale, sub } from './vec.ts';

/** Wall ends this close count as one corner (M3 design decision 3). */
export const WALL_JOIN_TOLERANCE = 0.01;

/** A region enclosed by wall centrelines, with no walls crossing it. */
export interface WallFace {
  polygon: Pt[];
  area: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

interface Segment {
  a: Pt;
  b: Pt;
  cuts: Pt[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Merges points within the tolerance; the first point of a cluster stands for all of it. */
function nodeMerger(tolerance: number) {
  const points: Pt[] = [];
  const grid = new Map<string, number[]>();
  const cell = (v: number) => Math.floor(v / tolerance);
  return {
    points,
    id(p: Pt): number {
      const cx = cell(p.x);
      const cy = cell(p.y);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const id of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (distance(points[id]!, p) <= tolerance) return id;
          }
        }
      }
      const id = points.length;
      points.push(p);
      const key = `${cx},${cy}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(id);
      else grid.set(key, [id]);
      return id;
    },
  };
}

function properCrossing(s: Segment, t: Segment): Pt | null {
  const r = sub(s.b, s.a);
  const q = sub(t.b, t.a);
  const denominator = cross(r, q);
  if (Math.abs(denominator) < EPSILON) return null;
  const ta = sub(t.a, s.a);
  const u = cross(ta, q) / denominator;
  const v = cross(ta, r) / denominator;
  return u > 0 && u < 1 && v > 0 && v < 1 ? add(s.a, scale(r, u)) : null;
}

/** Marks where other walls end on, or cross, each wall, so the walls can be split there. */
function cutSegments(segments: Segment[], tolerance: number) {
  const order = [...segments].sort((s, t) => s.minX - t.minX);
  const touch = (end: Pt, s: Segment) => {
    const { point } = closestOnSegment(end, s.a, s.b);
    if (distance(point, end) <= tolerance) s.cuts.push(point);
  };
  for (let i = 0; i < order.length; i++) {
    const s = order[i]!;
    for (let j = i + 1; j < order.length; j++) {
      const t = order[j]!;
      if (t.minX > s.maxX + tolerance) break;
      if (t.minY > s.maxY + tolerance || s.minY > t.maxY + tolerance) continue;
      touch(t.a, s);
      touch(t.b, s);
      touch(s.a, t);
      touch(s.b, t);
      const crossing = properCrossing(s, t);
      if (crossing) {
        s.cuts.push(crossing);
        t.cuts.push(crossing);
      }
    }
  }
}

/**
 * Every region enclosed by the walls' centrelines. Ends within `tolerance` of each other or of
 * another wall join; walls are split where others end on them or cross them. Walls that enclose
 * nothing (open ends, stubs into a room) are ignored.
 */
export function wallFaces(
  walls: Readonly<Record<Id, Wall>>,
  tolerance = WALL_JOIN_TOLERANCE,
): WallFace[] {
  const segments: Segment[] = [];
  for (const { a, b } of Object.values(walls)) {
    if (distance(a, b) <= tolerance) continue;
    segments.push({
      a,
      b,
      cuts: [],
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    });
  }
  cutSegments(segments, tolerance);

  const nodes = nodeMerger(tolerance);
  for (const s of segments) {
    nodes.id(s.a);
    nodes.id(s.b);
  }
  const adjacency = new Map<number, Set<number>>();
  const link = (u: number, v: number) => {
    let set = adjacency.get(u);
    if (!set) adjacency.set(u, (set = new Set()));
    set.add(v);
  };
  for (const s of segments) {
    const along = (p: Pt) => closestOnSegment(p, s.a, s.b).t;
    const ids = [s.a, ...s.cuts, s.b]
      .map((p) => ({ t: along(p), id: nodes.id(p) }))
      .sort((p, q) => p.t - q.t)
      .map((p) => p.id);
    for (let i = 1; i < ids.length; i++) {
      const u = ids[i - 1]!;
      const v = ids[i]!;
      if (u === v) continue;
      link(u, v);
      link(v, u);
    }
  }

  // Dead ends cannot bound a region; dropping them keeps spikes out of the faces.
  const dangling = [...adjacency.keys()].filter((u) => adjacency.get(u)!.size < 2);
  while (dangling.length > 0) {
    const u = dangling.pop()!;
    for (const v of adjacency.get(u) ?? []) {
      const around = adjacency.get(v)!;
      around.delete(u);
      if (around.size === 1) dangling.push(v);
    }
    adjacency.delete(u);
  }

  const { points } = nodes;
  const sorted = new Map<number, number[]>();
  for (const [u, around] of adjacency) {
    const p = points[u]!;
    const angle = (v: number) => Math.atan2(points[v]!.y - p.y, points[v]!.x - p.x);
    sorted.set(
      u,
      [...around].sort((v, w) => angle(v) - angle(w)),
    );
  }

  // Walking each directed edge and turning to the neighbour just before the reverse edge in angle
  // order traces every face once. Bounded faces come out with positive signed area, the unbounded
  // outside of each connected group of walls with negative.
  const faces: WallFace[] = [];
  const visited = new Set<number>();
  const edge = (u: number, v: number) => u * points.length + v;
  for (const [start, around] of sorted) {
    for (const first of around) {
      if (visited.has(edge(start, first))) continue;
      const cycle: number[] = [];
      let u = start;
      let v = first;
      do {
        visited.add(edge(u, v));
        cycle.push(u);
        const next = sorted.get(v)!;
        const back = next.indexOf(u);
        const w = next[(back - 1 + next.length) % next.length]!;
        u = v;
        v = w;
      } while (u !== start || v !== first);
      const raw = cycle.map((id) => points[id]!);
      const area = signedArea(raw);
      if (area <= EPSILON) continue;
      const polygon = withoutCollinear(raw);
      faces.push({ polygon, area, bounds: boundsOf(polygon) });
    }
  }
  return faces;
}

function boundsOf(polygon: readonly Pt[]): WallFace['bounds'] {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** The smallest face that contains the point, or null if no walls enclose it. */
export function faceAt(faces: readonly WallFace[], point: Pt): WallFace | null {
  let best: WallFace | null = null;
  for (const face of faces) {
    const { minX, minY, maxX, maxY } = face.bounds;
    if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) continue;
    if (best && face.area >= best.area) continue;
    if (pointInPolygon(point, face.polygon)) best = face;
  }
  return best;
}

/**
 * The room polygon around a point, along the centrelines of the walls that enclose it, or null when
 * they do not close around it (a gap wider than `tolerance`).
 */
export function fillRoom(
  walls: Readonly<Record<Id, Wall>>,
  point: Pt,
  tolerance = WALL_JOIN_TOLERANCE,
): Pt[] | null {
  return faceAt(wallFaces(walls, tolerance), point)?.polygon ?? null;
}
