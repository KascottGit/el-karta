import {
  add,
  combine,
  distance,
  normalize,
  putSpaceItem,
  scale,
  sub,
  type Edit,
  type Id,
  type Pt,
  type Wall,
} from '@el-karta/core';
import { JOINT_TOLERANCE, type WallEnd } from './wall-outline';

/** Below this a wall counts as zero length; validation flags such walls, so edits never make one. */
export const MIN_WALL_LENGTH = 0.01;

export interface EndRef {
  wallId: Id;
  end: WallEnd;
}

const otherEnd = (end: WallEnd): WallEnd => (end === 'a' ? 'b' : 'a');

/** Every wall end within a centimetre of `at`: the corner that moves together (M3 design decision 3). */
export function cornerAt(walls: Readonly<Record<Id, Wall>>, at: Pt): EndRef[] {
  const ends: EndRef[] = [];
  for (const wall of Object.values(walls)) {
    for (const end of ['a', 'b'] as const) {
      if (distance(wall[end], at) <= JOINT_TOLERANCE) ends.push({ wallId: wall.id, end });
    }
  }
  return ends;
}

/** The ends that stay put when `ends` move: the far end of each moving wall. */
export const fixedEnds = (walls: Readonly<Record<Id, Wall>>, ends: readonly EndRef[]): Pt[] =>
  ends.flatMap(({ wallId, end }) => {
    const wall = walls[wallId];
    return wall ? [wall[otherEnd(end)]] : [];
  });

/** Wall ends that move together to one point. */
export interface EndMove {
  ends: readonly EndRef[];
  to: Pt;
}

/**
 * The walls with each group of ends moved to its point, or null if that would leave one of them
 * shorter than `MIN_WALL_LENGTH`. A wall with both ends moving moves both.
 */
export function moveEndGroups(
  walls: Readonly<Record<Id, Wall>>,
  moves: readonly EndMove[],
): Wall[] | null {
  const moved = new Map<Id, Wall>();
  for (const { ends, to } of moves) {
    for (const { wallId, end } of ends) {
      const wall = moved.get(wallId) ?? walls[wallId];
      if (!wall) continue;
      moved.set(wallId, { ...wall, [end]: { x: to.x, y: to.y } });
    }
  }
  const result = [...moved.values()];
  return result.some((w) => distance(w.a, w.b) < MIN_WALL_LENGTH) ? null : result;
}

/** `moveEndGroups` for a single corner moved to `to`. */
export const moveEnds = (
  walls: Readonly<Record<Id, Wall>>,
  ends: readonly EndRef[],
  to: Pt,
): Wall[] | null => moveEndGroups(walls, [{ ends, to }]);

export const putWalls = (floorId: Id, walls: readonly Wall[]): Edit =>
  combine(...walls.map((wall) => putSpaceItem(floorId, 'walls', wall)));

/**
 * The walls changed by giving `wallId` a new length: its end `b` moves along the wall, together
 * with the corner it forms, so connected walls stay connected. Null if the length is too short.
 */
export function setLength(
  walls: Readonly<Record<Id, Wall>>,
  wallId: Id,
  length: number,
): Wall[] | null {
  const wall = walls[wallId];
  if (!wall || length < MIN_WALL_LENGTH) return null;
  const dir = normalize(sub(wall.b, wall.a));
  if (dir.x === 0 && dir.y === 0) return null;
  const to = add(wall.a, scale(dir, length));
  const ends = cornerAt(walls, wall.b).filter((e) => !(e.wallId === wallId && e.end === 'a'));
  return moveEnds(walls, ends, to);
}
