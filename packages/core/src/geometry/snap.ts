import type { FloorData, Id, Pt, Wall } from '../schemas/index.ts';
import { add, cross, distance, EPSILON, leftNormal, scale, sub } from './vec.ts';

type SnapFloor = Pick<FloorData, 'walls' | 'grid'>;

/** What a snapped point was drawn to. */
export type SnapTarget =
  /** A wall end, or one of the extra `points` (then without a wall). */
  | { kind: 'endpoint'; wallId?: Id; end?: 'a' | 'b' }
  | { kind: 'midpoint'; wallId: Id }
  /** The point projected onto a wall's centre line, `offset` metres from its end `a`. */
  | { kind: 'wall'; wallId: Id; offset: number }
  /** `axis: 'x'` is a line of the x series, i.e. the vertical line `x = pos`. */
  | { kind: 'grid'; axis: 'x' | 'y'; pos: number; label: string }
  /** On the ray from `from` at `angle` degrees, measured from +x towards +y (so 90 points down). */
  | { kind: 'angle'; from: Pt; angle: number };

export type SnapKind = SnapTarget['kind'];

export interface Snap {
  point: Pt;
  /** The strongest target, or `none` for a free point. */
  kind: SnapKind | 'none';
  /** Strongest first. Two targets mean the point is where two lines cross, e.g. a 90° ray and a wall. */
  targets: SnapTarget[];
}

export interface SnapOptions {
  /** Capture distance in metres; the UI converts it from pixels so it feels the same at every zoom. */
  tolerance: number;
  /** Points the new point connects to, for angle snapping: the previous point of a polyline, or the fixed ends of walls whose shared end is being dragged. */
  from?: readonly Pt[];
  /** Extra endpoint targets that are not walls yet, such as the points of a polyline being drawn. */
  points?: readonly Pt[];
  /** Walls to leave out entirely, such as the ones being moved. */
  ignore?: ReadonlySet<Id>;
  /** Degrees between angle rays. */
  angleStep?: number;
  /** A far point is drawn to an angle ray within this many degrees, a near one within `tolerance`. */
  angleTolerance?: number;
}

export const DEFAULT_ANGLE_STEP = 45;
export const DEFAULT_ANGLE_TOLERANCE = 3;

/**
 * Snap priority, strongest first. A point target (an endpoint, then a midpoint) within tolerance
 * always wins. Otherwise the crossing of two lines within reach wins, nearest first. Otherwise the
 * point is projected onto one line, by `LINE_PRIORITY` and then distance.
 */
export const LINE_PRIORITY: readonly ('wall' | 'grid' | 'angle')[] = ['wall', 'grid', 'angle'];

type LineTarget = Extract<SnapTarget, { kind: 'wall' | 'grid' | 'angle' }>;

interface Line {
  origin: Pt;
  /** Unit direction. */
  dir: Pt;
  min: number;
  max: number;
  /** How far from the line the cursor may be and still be drawn to it. */
  capture: number;
  /** The cursor's distance from the line. */
  distance: number;
  /** The target for a point `t` along the line. */
  target(t: number): LineTarget;
}

const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const along = (line: Line, t: number) => add(line.origin, scale(line.dir, t));
const rank = (target: SnapTarget) =>
  LINE_PRIORITY.indexOf(target.kind as (typeof LINE_PRIORITY)[number]);

/** The cursor's offset along a line and distance from it, or null if it is beyond the line's ends. */
function project(origin: Pt, dir: Pt, min: number, max: number, p: Pt) {
  const rel = sub(p, origin);
  const t = dot(rel, dir);
  if (t < min || t > max) return null;
  return { t, distance: Math.abs(cross(dir, rel)) };
}

/** A cheap test that rules out most walls before any vector maths. */
const nearBox = (wall: Wall, p: Pt, reach: number) =>
  p.x >= Math.min(wall.a.x, wall.b.x) - reach &&
  p.x <= Math.max(wall.a.x, wall.b.x) + reach &&
  p.y >= Math.min(wall.a.y, wall.b.y) - reach &&
  p.y <= Math.max(wall.a.y, wall.b.y) + reach;

function wallLine(wall: Wall, p: Pt, tolerance: number): Line | null {
  const delta = sub(wall.b, wall.a);
  const len = Math.hypot(delta.x, delta.y);
  if (len < EPSILON) return null;
  const dir = scale(delta, 1 / len);
  const hit = project(wall.a, dir, 0, len, p);
  const capture = tolerance + wall.thickness / 2;
  if (!hit || hit.distance > capture) return null;
  return {
    origin: wall.a,
    dir,
    min: 0,
    max: len,
    capture,
    distance: hit.distance,
    target: (t) => ({ kind: 'wall', wallId: wall.id, offset: t }),
  };
}

function gridLines(grid: SnapFloor['grid'], p: Pt, tolerance: number): Line[] {
  if (!grid) return [];
  const lines: Line[] = [];
  for (const [axis, series] of [
    ['x', grid.xLines],
    ['y', grid.yLines],
  ] as const) {
    for (const { pos, label } of series) {
      const d = Math.abs((axis === 'x' ? p.x : p.y) - pos);
      if (d > tolerance) continue;
      lines.push({
        origin: axis === 'x' ? { x: pos, y: 0 } : { x: 0, y: pos },
        dir: axis === 'x' ? { x: 0, y: 1 } : { x: 1, y: 0 },
        min: -Infinity,
        max: Infinity,
        capture: tolerance,
        distance: d,
        target: () => ({ kind: 'grid', axis, pos, label }),
      });
    }
  }
  return lines;
}

/** The nearest captured angle ray from `from`, if any. Rays from one point only cross at it, so one is enough. */
function angleLine(from: Pt, p: Pt, options: Required<SnapOptions>): Line | null {
  let best: Line | null = null;
  const sinTolerance = Math.sin((options.angleTolerance * Math.PI) / 180);
  for (let angle = 0; angle < 360 - EPSILON; angle += options.angleStep) {
    const rad = (angle * Math.PI) / 180;
    const dir = { x: Math.cos(rad), y: Math.sin(rad) };
    const hit = project(from, dir, 0, Infinity, p);
    if (!hit) continue;
    const capture = Math.max(options.tolerance, hit.t * sinTolerance);
    if (hit.distance > capture || (best && hit.distance >= best.distance)) continue;
    best = {
      origin: from,
      dir,
      min: 0,
      max: Infinity,
      capture,
      distance: hit.distance,
      target: () => ({ kind: 'angle', from, angle: Math.round(angle * 1e6) / 1e6 }),
    };
  }
  return best;
}

function crossing(l1: Line, l2: Line): { s: number; u: number } | null {
  const denom = cross(l1.dir, l2.dir);
  if (Math.abs(denom) < 1e-9) return null;
  const rel = sub(l2.origin, l1.origin);
  const s = cross(rel, l2.dir) / denom;
  const u = cross(rel, l1.dir) / denom;
  const within = (l: Line, t: number) => t >= l.min - EPSILON && t <= l.max + EPSILON;
  return within(l1, s) && within(l2, u) ? { s, u } : null;
}

/**
 * Snaps a point to wall ends and midpoints, crossings of lines, wall centre lines (T-junctions),
 * grid lines and angle steps from the `from` points, in that priority (see `LINE_PRIORITY`).
 */
export function snapPoint(floor: SnapFloor, p: Pt, options: SnapOptions): Snap {
  const opts: Required<SnapOptions> = {
    from: [],
    points: [],
    ignore: new Set(),
    angleStep: DEFAULT_ANGLE_STEP,
    angleTolerance: DEFAULT_ANGLE_TOLERANCE,
    ...options,
  };
  const { tolerance } = opts;

  let endpoint: { point: Pt; target: SnapTarget; d: number } | null = null;
  let midpoint: { point: Pt; target: SnapTarget; d: number } | null = null;
  const lines: Line[] = [];

  for (const point of opts.points) {
    const d = distance(point, p);
    if (d <= tolerance && (!endpoint || d < endpoint.d))
      endpoint = { point, target: { kind: 'endpoint' }, d };
  }
  for (const wall of Object.values(floor.walls)) {
    if (opts.ignore.has(wall.id) || !nearBox(wall, p, tolerance + wall.thickness / 2)) continue;
    const endCapture = Math.max(tolerance, wall.thickness / 2);
    for (const end of ['a', 'b'] as const) {
      const d = distance(wall[end], p);
      if (d <= endCapture && (!endpoint || d < endpoint.d))
        endpoint = { point: wall[end], target: { kind: 'endpoint', wallId: wall.id, end }, d };
    }
    if (endpoint) continue;
    const mid = scale(add(wall.a, wall.b), 0.5);
    const d = distance(mid, p);
    if (d <= tolerance && (!midpoint || d < midpoint.d))
      midpoint = { point: mid, target: { kind: 'midpoint', wallId: wall.id }, d };
    const line = wallLine(wall, p, tolerance);
    if (line) lines.push(line);
  }
  const point = endpoint ?? midpoint;
  if (point) return { point: point.point, kind: point.target.kind, targets: [point.target] };

  lines.push(...gridLines(floor.grid, p, tolerance));
  for (const from of opts.from) {
    const line = angleLine(from, p, opts);
    if (line) lines.push(line);
  }

  let best: { point: Pt; targets: SnapTarget[]; d: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const l1 = lines[i]!;
      const l2 = lines[j]!;
      const at = crossing(l1, l2);
      if (!at) continue;
      const x = along(l1, at.s);
      const d = distance(x, p);
      // For perpendicular lines this is exactly the reach of both captures together.
      if (d > Math.hypot(l1.capture, l2.capture) || (best && d >= best.d)) continue;
      const targets = [l1.target(at.s), l2.target(at.u)].sort((a, b) => rank(a) - rank(b));
      best = { point: x, targets, d };
    }
  }
  if (best) return { point: best.point, kind: best.targets[0]!.kind, targets: best.targets };

  let single: Line | null = null;
  for (const line of lines) {
    if (!single) single = line;
    else {
      const order = rank(line.target(0)) - rank(single.target(0));
      if (order < 0 || (order === 0 && line.distance < single.distance)) single = line;
    }
  }
  if (single) {
    const t = dot(sub(p, single.origin), single.dir);
    const target = single.target(t);
    return { point: along(single, t), kind: target.kind, targets: [target] };
  }
  return { point: p, kind: 'none', targets: [] };
}

export interface WallHit {
  wallId: Id;
  /** Metres from the wall's end `a` to the nearest point on its centre line, within [0, length]. */
  offset: number;
  /** The wall's length, for clamping what is placed along it. */
  length: number;
  /** Distance from the point to the centre line. */
  distance: number;
  /** Which side of the a→b direction the point is on; a point on the centre line counts as left. */
  side: 'left' | 'right';
}

/**
 * The wall nearest to a point, among those whose face is within `tolerance` of it (a point inside
 * a thick wall is at distance zero from it), or null. Walls without length are skipped.
 */
export function nearestWall(
  floor: Pick<FloorData, 'walls'>,
  p: Pt,
  tolerance: number,
): WallHit | null {
  let best: WallHit | null = null;
  let bestFace = Infinity;
  for (const wall of Object.values(floor.walls)) {
    if (!nearBox(wall, p, tolerance + wall.thickness / 2)) continue;
    const delta = sub(wall.b, wall.a);
    const length = Math.hypot(delta.x, delta.y);
    if (length < EPSILON) continue;
    const rel = sub(p, wall.a);
    const offset = Math.min(length, Math.max(0, dot(rel, delta) / length));
    const d = distance(p, add(wall.a, scale(delta, offset / length)));
    const face = Math.max(0, d - wall.thickness / 2);
    if (face > tolerance) continue;
    if (best && (face > bestFace || (face === bestFace && d >= best.distance))) continue;
    const side = dot(rel, leftNormal(delta)) >= 0 ? 'left' : 'right';
    best = { wallId: wall.id, offset, length, distance: d, side };
    bestFace = face;
  }
  return best;
}
