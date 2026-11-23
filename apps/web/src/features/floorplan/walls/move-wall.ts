import {
  add,
  cross,
  distance,
  dot,
  leftNormal,
  normalize,
  scale,
  sub,
  type Id,
  type Pt,
  type Wall,
} from '@el-karta/core';
import { cornerAt, MIN_WALL_LENGTH, moveEndGroups, type EndRef } from './corner';
import { endKey, JOINT_TOLERANCE } from './wall-outline';

/**
 * Lines closer to parallel than this (the sine of about 1°) count as parallel: a joined wall at
 * such an angle moves its end with the wall instead of being stretched to a far-away crossing.
 */
export const PARALLEL_SIN = Math.sin(Math.PI / 180);

/** Wall ends at one point on the moved wall's line that stay together while it moves. */
interface Joint {
  /** `end`: an end of the moved wall; `onto`: a T onto the moved wall's middle. */
  kind: 'end' | 'onto';
  at: Pt;
  ends: readonly EndRef[];
  /** The unit direction the point slides along to reach the moved line, or null to move with the wall. */
  along: Pt | null;
  /** For an `end` on another wall's middle: that wall, which the end must stay on. */
  hostId: Id | null;
}

/** What moving one wall along its normal drags along. Found once per drag; see `moveWall`. */
export interface WallMovePlan {
  wall: Wall;
  /** The wall's unit left normal: a positive offset moves it this way. */
  normal: Pt;
  joints: readonly Joint[];
  /** The moved wall and every wall with an end in one of the joints. */
  moving: ReadonlySet<Id>;
}

const dirOf = (wall: Wall) => normalize(sub(wall.b, wall.a));

/** Where `p` lies along the wall from `a` (metres) and how far off its centre line. */
function onLine(wall: Wall, p: Pt) {
  const dir = dirOf(wall);
  const rel = sub(p, wall.a);
  return { t: dot(rel, dir), off: Math.abs(cross(dir, rel)) };
}

/** Whether `p` is on the wall's centre line, a centimetre or more from both its ends. */
function onMiddle(wall: Wall, p: Pt) {
  const { t, off } = onLine(wall, p);
  return (
    off <= JOINT_TOLERANCE && t > JOINT_TOLERANCE && t < distance(wall.a, wall.b) - JOINT_TOLERANCE
  );
}

/** The wall most nearly perpendicular to `dir`, or null if all are about parallel to it. */
function steepest(candidates: readonly Wall[], dir: Pt): Wall | null {
  let best: Wall | null = null;
  let bestSin = PARALLEL_SIN;
  for (const c of candidates) {
    const sin = Math.abs(cross(dirOf(c), dir));
    if (sin >= bestSin) {
      best = c;
      bestSin = sin;
    }
  }
  return best;
}

/**
 * What moving `wallId` along its normal drags along, or null for an unknown wall or one without
 * length:
 * - At each end, the corner it forms (`cornerAt`). The corner slides along the line of a wall the
 *   end sits on the middle of (a T from the moved wall), else along the joined wall most nearly
 *   perpendicular to the moved one, else (a straight continuation, or no other wall) moves with it.
 * - Wall ends on the moved wall's centre line between its ends (a T onto it), grouped by corner,
 *   slide along the steepest of their own walls the same way.
 */
export function planWallMove(walls: Readonly<Record<Id, Wall>>, wallId: Id): WallMovePlan | null {
  const wall = walls[wallId];
  if (!wall || distance(wall.a, wall.b) < MIN_WALL_LENGTH) return null;
  const dir = dirOf(wall);
  const seen = new Set<string>();
  const joints: Joint[] = [];
  const addJoint = (kind: Joint['kind'], at: Pt, hosts: readonly Wall[]) => {
    const ends = cornerAt(walls, at);
    for (const e of ends) seen.add(endKey(e.wallId, e.end));
    const others = ends.filter((e) => e.wallId !== wallId).flatMap((e) => walls[e.wallId] ?? []);
    const host = steepest(hosts, dir);
    const guide = host ?? steepest(others, dir);
    joints.push({ kind, at, ends, along: guide && dirOf(guide), hostId: host?.id ?? null });
  };

  for (const end of ['a', 'b'] as const) {
    const at = wall[end];
    const hosts = Object.values(walls).filter((w) => w.id !== wallId && onMiddle(w, at));
    addJoint('end', at, hosts);
  }
  for (const other of Object.values(walls)) {
    if (other.id === wallId) continue;
    for (const end of ['a', 'b'] as const) {
      if (!seen.has(endKey(other.id, end)) && onMiddle(wall, other[end]))
        addJoint('onto', other[end], []);
    }
  }
  const moving = new Set([wallId, ...joints.flatMap((j) => j.ends.map((e) => e.wallId))]);
  return { wall, normal: leftNormal(dir), joints, moving };
}

/** Whether `p` lies along the wall between its ends (it is on the wall's line). */
function within(wall: Wall, p: Pt) {
  const t = dot(sub(p, wall.a), dirOf(wall));
  return t >= -JOINT_TOLERANCE && t <= distance(wall.a, wall.b) + JOINT_TOLERANCE;
}

/**
 * The walls changed by moving the planned wall `offset` metres along its normal, or null if a
 * wall would get shorter than `MIN_WALL_LENGTH` or turn around, or a T would come apart: an end
 * slid past the end of the wall it sits on, or a wall ending on the moved wall's middle now
 * meeting its line beyond the moved wall's ends. Joined walls keep their direction.
 */
export function applyWallMove(
  walls: Readonly<Record<Id, Wall>>,
  plan: WallMovePlan,
  offset: number,
): Wall[] | null {
  const { wall, normal, joints } = plan;
  const origin = add(wall.a, scale(normal, offset));
  const moves = joints.map(({ at, ends, along }) => {
    const to = along
      ? add(at, scale(along, dot(sub(origin, at), normal) / dot(along, normal)))
      : add(at, scale(normal, offset));
    return { ends, to };
  });
  const moved = moveEndGroups(walls, moves);
  if (!moved) return null;
  const movedWall = moved.find((w) => w.id === wall.id);
  const apart = joints.some(({ kind, hostId }, i) => {
    const { to } = moves[i]!;
    if (kind === 'onto') return !!movedWall && !within(movedWall, to);
    const host = hostId === null ? undefined : walls[hostId];
    return !!host && !within(host, to);
  });
  if (apart) return null;
  const turned = moved.some((w) => {
    const before = walls[w.id];
    return before && dot(sub(w.b, w.a), sub(before.b, before.a)) <= 0;
  });
  return turned ? null : moved;
}

/**
 * Moves a wall `offset` metres along its left normal, keeping every joined wall connected (M9b
 * design decision 3). Returns every changed wall, or null. Openings keep their offsets and rooms
 * are left alone.
 */
export function moveWall(
  walls: Readonly<Record<Id, Wall>>,
  wallId: Id,
  offset: number,
): Wall[] | null {
  const plan = planWallMove(walls, wallId);
  return plan && applyWallMove(walls, plan, offset);
}
