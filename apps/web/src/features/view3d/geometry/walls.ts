import {
  add,
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
import { endKey, jointEnds } from '@/features/floorplan/walls/wall-outline';
import type { WallPiece } from './types';

/** Shorter pieces than this (1 mm) are dropped; they only come from openings touching each other. */
const MIN_PIECE = 0.001;

interface Hole {
  start: number;
  end: number;
  bottom: number;
  top: number;
}

/**
 * Every wall of the floor as boxes, split around its openings. A wall end that meets another
 * wall's end is extended by half the wall's thickness so L and T corners close. An end that meets
 * the middle of another wall already reaches into that wall's body and is left as it is.
 */
export function wallPieces(floor: FloorData): WallPiece[] {
  const openingsByWall = new Map<Id, Opening[]>();
  for (const opening of Object.values(floor.openings)) {
    const list = openingsByWall.get(opening.wallId);
    if (list) list.push(opening);
    else openingsByWall.set(opening.wallId, [opening]);
  }
  const joined = jointEnds(floor.walls);
  const pieces: WallPiece[] = [];
  for (const wall of Object.values(floor.walls)) {
    piecesOfWall(
      wall,
      wall.height ?? floor.height,
      openingsByWall.get(wall.id) ?? [],
      joined.has(endKey(wall.id, 'a')),
      joined.has(endKey(wall.id, 'b')),
      pieces,
    );
  }
  return pieces;
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
  const holes = openings.flatMap((o) => holeOf(o, length, height));
  const from = extendA ? -wall.thickness / 2 : 0;
  const to = length + (extendB ? wall.thickness / 2 : 0);
  const cuts = [...new Set([from, to, ...holes.flatMap((h) => [h.start, h.end])])].sort(
    (p, q) => p - q,
  );

  const dir = normalize(sub(wall.b, wall.a));
  const rotation = Math.atan2(dir.y, dir.x);
  const emit = (start: number, end: number, solids: readonly [number, number][]) => {
    if (end - start < MIN_PIECE) return;
    const mid = add(wall.a, scale(dir, (start + end) / 2));
    for (const [bottom, top] of solids) {
      out.push({
        wallId: wall.id,
        center: { x: mid.x, y: mid.y, z: (bottom + top) / 2 },
        size: { x: end - start, y: wall.thickness, z: top - bottom },
        rotation,
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

/** The opening's cut-out, clamped to the wall. `offset` is the opening's start, measured from `a`. */
function holeOf(opening: Opening, length: number, height: number): Hole[] {
  const start = clamp(opening.offset, 0, length);
  const end = clamp(opening.offset + opening.width, 0, length);
  const sill = opening.sill ?? 0;
  const bottom = clamp(sill, 0, height);
  const top = clamp(sill + opening.height, 0, height);
  return end - start > EPSILON && top - bottom > EPSILON ? [{ start, end, bottom, top }] : [];
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

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
