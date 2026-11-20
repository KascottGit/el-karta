import {
  add,
  distance,
  leftNormal,
  normalize,
  scale,
  sub,
  type Id,
  type Pt,
  type Wall,
} from '@el-karta/core';
import { boundsOf, type Rect } from '../canvas/rect';

/** Endpoints this close count as one corner (M3 design decision 3). */
export const JOINT_TOLERANCE = 0.01;

export type WallEnd = 'a' | 'b';
export const endKey = (wallId: Id, end: WallEnd) => `${wallId}:${end}`;

const jointCache = new WeakMap<Readonly<Record<Id, Wall>>, ReadonlySet<string>>();

/** The wall ends that meet another wall's end, as `endKey`s. Cached per walls record. */
export function jointEnds(walls: Readonly<Record<Id, Wall>>): ReadonlySet<string> {
  let joined = jointCache.get(walls);
  if (!joined) {
    joined = findJoints(walls);
    jointCache.set(walls, joined);
  }
  return joined;
}

function findJoints(walls: Readonly<Record<Id, Wall>>): ReadonlySet<string> {
  const cell = (v: number) => Math.floor(v / JOINT_TOLERANCE);
  const buckets = new Map<string, { wallId: Id; end: WallEnd; p: Pt }[]>();
  const ends = Object.values(walls).flatMap((w) => [
    { wallId: w.id, end: 'a' as const, p: w.a },
    { wallId: w.id, end: 'b' as const, p: w.b },
  ]);
  for (const e of ends) {
    const key = `${cell(e.p.x)},${cell(e.p.y)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(e);
    else buckets.set(key, [e]);
  }
  const joined = new Set<string>();
  for (const e of ends) {
    const cx = cell(e.p.x);
    const cy = cell(e.p.y);
    search: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (other.wallId !== e.wallId && distance(other.p, e.p) <= JOINT_TOLERANCE) {
            joined.add(endKey(e.wallId, e.end));
            break search;
          }
        }
      }
    }
  }
  return joined;
}

/**
 * The wall's footprint as a flat [x0, y0, x1, y1, …] polygon. A joined end is extended by half the
 * thickness so that two walls meeting at a corner leave no notch.
 */
export function wallOutline(wall: Wall, capA: boolean, capB: boolean): number[] {
  const dir = normalize(sub(wall.b, wall.a));
  const half = wall.thickness / 2;
  const a = capA ? sub(wall.a, scale(dir, half)) : wall.a;
  const b = capB ? add(wall.b, scale(dir, half)) : wall.b;
  const n = scale(leftNormal(dir), half);
  return [add(a, n), add(b, n), sub(b, n), sub(a, n)].flatMap((p) => [p.x, p.y]);
}

export const wallBounds = (wall: Wall): Rect | null => boundsOf([wall.a, wall.b], wall.thickness);
