import {
  EPSILON,
  normalize,
  scale,
  sub,
  wallLength,
  type FloorData,
  type Id,
  type Opening,
  type Wall,
} from '@el-karta/core';
import {
  endKey,
  JOINT_TOLERANCE,
  jointEnds,
  type WallEnd,
} from '@/features/floorplan/walls/wall-outline';
import type { WallPiece } from './types';
import { boxAlongWall, openingHole, type Hole } from './wall-frame';

/** Shorter pieces than this (1 mm) are dropped; they only come from openings touching each other. */
const MIN_PIECE = 0.001;

/** Sine of the largest angle (about 1°) at which two joined walls still count as one straight line. */
const STRAIGHT = 0.02;

/**
 * Every wall of the floor as boxes, split around its openings. A wall end that meets another
 * wall's end is extended by half the wall's thickness so L and T corners close, unless another
 * wall there continues it in a straight line: that pair is already continuous, and extending it
 * would overlap the neighbour (coplanar faces, and a sliver inside an opening at the joint). An end
 * that meets the middle of another wall already reaches into that wall's body and is left as it is.
 */
export function wallPieces(floor: FloorData): WallPiece[] {
  const openingsByWall = new Map<Id, Opening[]>();
  for (const opening of Object.values(floor.openings)) {
    const list = openingsByWall.get(opening.wallId);
    if (list) list.push(opening);
    else openingsByWall.set(opening.wallId, [opening]);
  }
  const joined = jointEnds(floor.walls);
  const continued = continuedEnds(floor.walls, joined);
  const extends_ = (wallId: Id, end: WallEnd) => {
    const key = endKey(wallId, end);
    return joined.has(key) && !continued.has(key);
  };
  const pieces: WallPiece[] = [];
  for (const wall of Object.values(floor.walls)) {
    piecesOfWall(
      wall,
      wall.height ?? floor.height,
      openingsByWall.get(wall.id) ?? [],
      extends_(wall.id, 'a'),
      extends_(wall.id, 'b'),
      pieces,
    );
  }
  return pieces;
}

/** Joined ends where another wall's end continues the wall in a straight line. */
function continuedEnds(
  walls: Readonly<Record<Id, Wall>>,
  joined: ReadonlySet<string>,
): ReadonlySet<string> {
  const cell = (v: number) => Math.floor(v / JOINT_TOLERANCE);
  const ends: { key: string; wallId: Id; p: Wall['a']; into: Wall['a'] }[] = [];
  for (const w of Object.values(walls)) {
    if (wallLength(w) < EPSILON) continue;
    const d = normalize(sub(w.b, w.a));
    for (const [end, p, into] of [
      ['a', w.a, d],
      ['b', w.b, scale(d, -1)],
    ] as const) {
      const key = endKey(w.id, end);
      if (joined.has(key)) ends.push({ key, wallId: w.id, p, into });
    }
  }
  const buckets = new Map<string, typeof ends>();
  for (const e of ends) {
    const k = `${cell(e.p.x)},${cell(e.p.y)}`;
    const bucket = buckets.get(k);
    if (bucket) bucket.push(e);
    else buckets.set(k, [e]);
  }
  const continued = new Set<string>();
  for (const e of ends) {
    const cx = cell(e.p.x);
    const cy = cell(e.p.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const o of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (o.wallId === e.wallId) continue;
          const cross = e.into.x * o.into.y - e.into.y * o.into.x;
          const dot = e.into.x * o.into.x + e.into.y * o.into.y;
          if (Math.abs(cross) < STRAIGHT && dot < 0) continued.add(e.key);
        }
      }
    }
  }
  return continued;
}

function piecesOfWall(
  wall: Wall,
  height: number,
  openings: readonly Opening[],
  extendA: boolean,
  extendB: boolean,
  out: WallPiece[],
): void {
  const length = wallLength(wall);
  if (length < EPSILON) return;
  const holes = openings.flatMap((o) => openingHole(o, length, height) ?? []);
  const from = extendA ? -wall.thickness / 2 : 0;
  const to = length + (extendB ? wall.thickness / 2 : 0);
  const cuts = [...new Set([from, to, ...holes.flatMap((h) => [h.start, h.end])])].sort(
    (p, q) => p - q,
  );

  const emit = (start: number, end: number, solids: readonly [number, number][]) => {
    if (end - start < MIN_PIECE) return;
    for (const [bottom, top] of solids) {
      out.push({
        wallId: wall.id,
        ...boxAlongWall(wall, { start, end, bottom, top }, wall.thickness),
      });
    }
  };

  let runStart = from;
  let runSolids: [number, number][] | null = null;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const start = cuts[i]!;
    const end = cuts[i + 1]!;
    if (end - start < EPSILON) continue;
    const covering = holes.filter((h) => h.start <= start + EPSILON && h.end >= end - EPSILON);
    const solids = solidRanges(covering, height);
    if (runSolids && sameRanges(runSolids, solids)) continue;
    if (runSolids) emit(runStart, start, runSolids);
    runStart = start;
    runSolids = solids;
  }
  if (runSolids) emit(runStart, to, runSolids);
}

/** The z ranges of [0, height] left solid around the holes. */
function solidRanges(holes: readonly Hole[], height: number): [number, number][] {
  const ranges: [number, number][] = [];
  let z = 0;
  for (const hole of [...holes].sort((p, q) => p.bottom - q.bottom)) {
    if (hole.bottom - z > MIN_PIECE) ranges.push([z, hole.bottom]);
    z = Math.max(z, hole.top);
  }
  if (height - z > MIN_PIECE) ranges.push([z, height]);
  return ranges;
}

const sameRanges = (p: readonly [number, number][], q: readonly [number, number][]) =>
  p.length === q.length && p.every(([b, t], i) => b === q[i]![0] && t === q[i]![1]);
