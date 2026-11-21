import {
  add,
  closestOnSegment,
  cross,
  distance,
  dot,
  EPSILON,
  normalize,
  scale,
  sub,
  type Pt,
} from '@el-karta/core';

/** A wall as a centreline segment, in whatever unit the caller works in (pixels or metres). */
export interface Segment {
  a: Pt;
  b: Pt;
  thickness: number;
  exterior: boolean;
}

export interface CleanupTolerances {
  /** Walls within this many degrees of the main orientation, or its perpendicular, are snapped to it. */
  snapAngle: number;
  /** A main orientation this many degrees from the page axes is taken to be the page axes. */
  pageAngle: number;
  /** Parallel snapped walls whose lines are this close are moved onto one line. */
  align: number;
  /** Segments within this many degrees of each other may merge… */
  collinearAngle: number;
  /** …when both ends of one are this close to the line of the other… */
  collinearDistance: number;
  /** …and they overlap or leave a gap no longer than this. */
  gap: number;
  /** A wall end this close (plus half the other wall's thickness) to another wall's line is joined to it. */
  join: number;
  /** Shorter walls are dropped as fragments. */
  minLength: number;
}

/** In metres, for walls read off a plan image (M4 design decision 1). */
export const WALL_CLEANUP: CleanupTolerances = {
  snapAngle: 7,
  pageAngle: 1,
  align: 0.1,
  collinearAngle: 5,
  collinearDistance: 0.12,
  gap: 0.25,
  join: 0.25,
  minLength: 0.3,
};

const RAD = Math.PI / 180;
const segLength = (s: Segment) => distance(s.a, s.b);
const angleOf = (s: Segment) => Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
const midpoint = (s: Segment) => scale(add(s.a, s.b), 0.5);

/** Wraps an angle into (-period/2, period/2]. */
function wrap(angle: number, period: number): number {
  const r = angle - period * Math.round(angle / period);
  return r <= -period / 2 ? r + period : r;
}

/**
 * The plan's main wall direction in radians, in (-45°, 45°]: the length-weighted mean of the wall
 * angles modulo 90°, so walls and their perpendiculars count towards the same direction.
 */
export function dominantOrientation(segments: readonly Segment[]): number {
  let c = 0;
  let s = 0;
  for (const seg of segments) {
    const w = segLength(seg);
    const phi = angleOf(seg);
    c += w * Math.cos(4 * phi);
    s += w * Math.sin(4 * phi);
  }
  if (Math.hypot(c, s) < EPSILON) return 0;
  return wrap(Math.atan2(s, c) / 4, Math.PI / 2);
}

function rotateAbout(s: Segment, centre: Pt, angle: number): Segment {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const turn = (p: Pt): Pt => {
    const d = sub(p, centre);
    return add(centre, { x: cos * d.x - sin * d.y, y: sin * d.x + cos * d.y });
  };
  return { ...s, a: turn(s.a), b: turn(s.b) };
}

interface Oriented extends Segment {
  /** 0 along the main orientation, 1 across it, null when not snapped. */
  axis: 0 | 1 | null;
}

export function snapToOrientation(
  segments: readonly Segment[],
  theta: number,
  toleranceDeg: number,
): Oriented[] {
  return segments.map((s) => {
    const delta = wrap(angleOf(s) - theta, Math.PI / 2);
    if (Math.abs(delta) > toleranceDeg * RAD) return { ...s, axis: null };
    const axis = Math.abs(wrap(angleOf(s) - theta, Math.PI)) < Math.PI / 4 ? 0 : 1;
    return { ...rotateAbout(s, midpoint(s), -delta), axis };
  });
}

/** Moves snapped parallel walls whose lines are within `tolerance` onto their length-weighted mean line. */
export function alignParallel(segments: readonly Oriented[], theta: number, tolerance: number) {
  const out = segments.map((s) => ({ ...s }));
  for (const axis of [0, 1] as const) {
    const angle = theta + (axis * Math.PI) / 2;
    const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
    const items = out
      .map((s, i) => ({ i, c: dot(midpoint(s), normal), w: segLength(s) }))
      .filter(({ i }) => out[i]!.axis === axis)
      .sort((p, q) => p.c - q.c);
    let group: typeof items = [];
    const flush = () => {
      const total = group.reduce((sum, g) => sum + g.w, 0);
      const mean = group.reduce((sum, g) => sum + g.c * g.w, 0) / (total || 1);
      for (const g of group) {
        const shift = scale(normal, mean - g.c);
        const s = out[g.i]!;
        out[g.i] = { ...s, a: add(s.a, shift), b: add(s.b, shift) };
      }
      group = [];
    };
    for (const item of items) {
      const first = group[0];
      const last = group[group.length - 1];
      if (first && last && (item.c - last.c > tolerance || item.c - first.c > 2 * tolerance))
        flush();
      group.push(item);
    }
    flush();
  }
  return out;
}

class UnionFind {
  readonly #parent: number[];
  constructor(n: number) {
    this.#parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    let root = i;
    while (this.#parent[root] !== root) root = this.#parent[root]!;
    this.#parent[i] = root;
    return root;
  }
  union(i: number, j: number) {
    this.#parent[this.find(i)] = this.find(j);
  }
}

const lineDistance = (p: Pt, origin: Pt, dir: Pt) => Math.abs(cross(dir, sub(p, origin)));

/**
 * Joins segments that lie on one line and overlap or nearly touch into one spanning all of them,
 * on the line of the longest. `bridges` (such as openings) take part in joining, so two walls either
 * side of a door become one, but a group of bridges alone yields nothing.
 */
export function mergeCollinear<S extends Segment>(
  segments: readonly S[],
  tolerances: Pick<CleanupTolerances, 'collinearAngle' | 'collinearDistance' | 'gap'>,
  bridges: readonly { a: Pt; b: Pt }[] = [],
): S[] {
  const all: { s: S | null; a: Pt; b: Pt }[] = [
    ...segments.map((s) => ({ s, a: s.a, b: s.b })),
    ...bridges.map((b) => ({ s: null, a: b.a, b: b.b })),
  ];
  const sinTolerance = Math.sin(tolerances.collinearAngle * RAD);
  const uf = new UnionFind(all.length);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const p = all[i]!;
      const q = all[j]!;
      const [long, short] = distance(p.a, p.b) >= distance(q.a, q.b) ? [p, q] : [q, p];
      const dir = normalize(sub(long.b, long.a));
      const shortDir = normalize(sub(short.b, short.a));
      if (Math.abs(cross(dir, shortDir)) > sinTolerance) continue;
      if (
        lineDistance(short.a, long.a, dir) > tolerances.collinearDistance ||
        lineDistance(short.b, long.a, dir) > tolerances.collinearDistance
      )
        continue;
      const t0 = dot(sub(short.a, long.a), dir);
      const t1 = dot(sub(short.b, long.a), dir);
      const end = distance(long.a, long.b);
      if (Math.max(t0, t1) < -tolerances.gap || Math.min(t0, t1) > end + tolerances.gap) continue;
      uf.union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < all.length; i++) {
    const root = uf.find(i);
    const group = groups.get(root);
    if (group) group.push(i);
    else groups.set(root, [i]);
  }
  const out: S[] = [];
  for (const members of groups.values()) {
    const walls = members.map((i) => all[i]!.s).filter((s): s is S => s !== null);
    if (walls.length === 0) continue;
    const base = walls.reduce((best, s) => (segLength(s) > segLength(best) ? s : best));
    if (members.length === 1) {
      out.push(base);
      continue;
    }
    const dir = normalize(sub(base.b, base.a));
    let min = Infinity;
    let max = -Infinity;
    for (const i of members) {
      for (const p of [all[i]!.a, all[i]!.b]) {
        const t = dot(sub(p, base.a), dir);
        min = Math.min(min, t);
        max = Math.max(max, t);
      }
    }
    const total = walls.reduce((sum, s) => sum + segLength(s), 0);
    const exteriorLength = walls.reduce((sum, s) => sum + (s.exterior ? segLength(s) : 0), 0);
    out.push({
      ...base,
      a: add(base.a, scale(dir, min)),
      b: add(base.a, scale(dir, max)),
      thickness: walls.reduce((sum, s) => sum + s.thickness * segLength(s), 0) / (total || 1),
      exterior: exteriorLength * 2 >= total,
    });
  }
  return out;
}

/** Where the lines through two segments cross, as parameters along each (0 at `a`, 1 at `b`). */
function lineCrossing(s: Segment, t: Segment): { u: number; v: number; point: Pt } | null {
  const r = sub(s.b, s.a);
  const q = sub(t.b, t.a);
  const denominator = cross(r, q);
  if (Math.abs(denominator) < EPSILON) return null;
  const rel = sub(t.a, s.a);
  const u = cross(rel, q) / denominator;
  const v = cross(rel, r) / denominator;
  return { u, v, point: add(s.a, scale(r, u)) };
}

/**
 * Extends or trims each wall end that stops near another, non-parallel wall onto that wall's
 * centreline, closing corners and T-junctions. Ends only move along their own wall, so the result
 * does not depend on the order of the walls.
 */
export function joinEnds<S extends Segment>(segments: readonly S[], tolerance: number): S[] {
  const minSin = Math.sin(20 * RAD);
  return segments.map((s, i) => {
    const len = segLength(s);
    if (len < EPSILON) return s;
    const moved = { a: s.a, b: s.b };
    for (const end of ['a', 'b'] as const) {
      let best: { point: Pt; d: number } | null = null;
      for (let j = 0; j < segments.length; j++) {
        if (j === i) continue;
        const t = segments[j]!;
        const tLen = segLength(t);
        if (tLen < EPSILON) continue;
        const sinAngle = Math.abs(cross(sub(s.b, s.a), sub(t.b, t.a))) / (len * tLen);
        if (sinAngle < minSin) continue;
        const hit = lineCrossing(s, t);
        if (!hit) continue;
        const d = distance(hit.point, s[end]);
        if (d > tolerance + t.thickness / 2) continue;
        const reach = (tolerance + s.thickness / 2) / tLen;
        if (hit.v < -reach || hit.v > 1 + reach) continue;
        // The end may not move past the wall's other end.
        if (end === 'a' ? hit.u >= 1 : hit.u <= 0) continue;
        if (!best || d < best.d) best = { point: hit.point, d };
      }
      if (best) moved[end] = best.point;
    }
    return { ...s, ...moved };
  });
}

export interface CleanWall extends Segment {
  /** Whether each end meets another wall. */
  joined: { a: boolean; b: boolean };
}

/**
 * Decision 1's wall cleanup: snap to the plan's own orientation (not the screen axes), align
 * parallel lines, merge collinear pieces (across `bridges`, the openings), join ends into corners and
 * T-junctions, and drop fragments. `page` is the angle in radians of the image's axes in these
 * coordinates; a plan drawn square to the page is snapped exactly to it.
 */
export function cleanWalls(
  segments: readonly Segment[],
  bridges: readonly { a: Pt; b: Pt }[] = [],
  page = 0,
  tolerances: CleanupTolerances = WALL_CLEANUP,
): CleanWall[] {
  const found = dominantOrientation(segments);
  const offPage = wrap(found - page, Math.PI / 2);
  const theta = Math.abs(offPage) <= tolerances.pageAngle * RAD ? found - offPage : found;
  const snapped = snapToOrientation(segments, theta, tolerances.snapAngle);
  const aligned = alignParallel(snapped, theta, tolerances.align);
  const merged = mergeCollinear(aligned, tolerances, bridges);
  const joined = joinEnds(merged, tolerances.join);
  const kept = mergeCollinear(joined, tolerances).filter(
    (s) => segLength(s) >= tolerances.minLength,
  );
  const touches = (p: Pt, self: number) =>
    kept.some((t, j) => j !== self && distance(closestOnSegment(p, t.a, t.b).point, p) < 1e-6);
  return kept.map(({ a, b, thickness, exterior }, i) => ({
    a,
    b,
    thickness,
    exterior,
    joined: { a: touches(a, i), b: touches(b, i) },
  }));
}
