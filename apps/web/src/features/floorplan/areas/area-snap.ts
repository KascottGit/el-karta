import { closestOnSegment, distance, type FloorData, type Id, type Pt } from '@el-karta/core';

interface PointTarget {
  p: Pt;
  owner: Id;
}

interface SegmentTarget {
  a: Pt;
  b: Pt;
  owner: Id;
}

/** What a room or zone corner can snap to: wall ends and centrelines, and other polygons' corners and sides. */
export interface AreaSnapTargets {
  points: readonly PointTarget[];
  segments: readonly SegmentTarget[];
}

export interface AreaSnap {
  point: Pt;
  snapped: boolean;
}

const cache = new WeakMap<FloorData, AreaSnapTargets>();

export function areaSnapTargets(data: FloorData): AreaSnapTargets {
  let targets = cache.get(data);
  if (targets) return targets;
  const points: PointTarget[] = [];
  const segments: SegmentTarget[] = [];
  for (const wall of Object.values(data.walls)) {
    points.push({ p: wall.a, owner: wall.id }, { p: wall.b, owner: wall.id });
    segments.push({ a: wall.a, b: wall.b, owner: wall.id });
  }
  for (const area of [...Object.values(data.rooms), ...Object.values(data.zones)]) {
    area.polygon.forEach((p, i) => {
      points.push({ p, owner: area.id });
      const next = area.polygon[(i + 1) % area.polygon.length];
      if (next && area.polygon.length > 1) segments.push({ a: p, b: next, owner: area.id });
    });
  }
  targets = { points, segments };
  cache.set(data, targets);
  return targets;
}

function nearestWithin(p: Pt, candidates: Iterable<Pt>, tolerance: number): Pt | null {
  let best: Pt | null = null;
  let bestDistance = tolerance;
  for (const candidate of candidates) {
    const d = distance(candidate, p);
    if (d <= bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * Snaps to the nearest corner within `tolerance`, else to the nearest wall or polygon side. Corners
 * win so that a point near a corner lands on it rather than on one of the sides meeting there.
 * Targets owned by `ignore` (the polygon being edited) are skipped; `extra` adds more corners, such
 * as the points of the polygon being drawn.
 */
export function snapAreaPoint(
  p: Pt,
  targets: AreaSnapTargets,
  tolerance: number,
  { ignore, extra = [] }: { ignore?: Id; extra?: readonly Pt[] } = {},
): AreaSnap {
  const corner = nearestWithin(
    p,
    [...targets.points.filter((t) => t.owner !== ignore).map((t) => t.p), ...extra],
    tolerance,
  );
  if (corner) return { point: corner, snapped: true };
  const side = nearestWithin(
    p,
    targets.segments
      .filter((s) => s.owner !== ignore)
      .map((s) => closestOnSegment(p, s.a, s.b).point),
    tolerance,
  );
  return side ? { point: side, snapped: true } : { point: p, snapped: false };
}
