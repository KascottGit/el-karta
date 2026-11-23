import {
  add,
  EPSILON,
  leftNormal,
  normalize,
  scale,
  sub,
  wallLength,
  type FloorData,
  type Id,
  type Pt,
  type Vec3,
} from '@el-karta/core';
import type { PointerKind } from '@/features/floorplan/canvas/gestures';
import type { SelectionItem } from '@/features/floorplan/canvas/selection';
import { openingHole } from '../geometry/wall-frame';
import type { HandleName } from './handle-names';
import { distanceToSegment } from './ray';

export type { HandleName };

/** A gizmo edits one selected wall or opening. */
export interface GizmoTarget {
  collection: 'walls' | 'openings';
  id: Id;
}

/**
 * How a handle follows the pointer: along an axis through it (`dir` a unit vector in plan
 * coordinates), or in the horizontal plane through it.
 */
export type Constraint = { kind: 'axis'; dir: Vec3 } | { kind: 'level' };

export type HandleShape = 'arrow' | 'sphere' | 'cube';

export interface GizmoHandle {
  name: HandleName;
  /** Floor-local plan coordinates, z from the floor's surface. */
  at: Vec3;
  constraint: Constraint;
  shape: HandleShape;
}

/** Each shape's size on screen in CSS pixels, whatever the distance: an arrow's length, else its width. */
export const HANDLE_PX: Readonly<Record<HandleShape, number>> = { arrow: 44, sphere: 16, cube: 14 };

/** How far from a handle a press still grabs it, in CSS pixels; a fingertip covers more than a cursor. */
export const GRAB_PX: Readonly<Record<PointerKind, number>> = { mouse: 10, pen: 12, touch: 24 };

const UP: Vec3 = { x: 0, y: 0, z: 1 };
const flat = (p: Pt, z: number): Vec3 => ({ x: p.x, y: p.y, z });

/** The single wall or opening a gizmo is shown for, or null for any other selection. */
export function gizmoTarget(selection: readonly SelectionItem[]): GizmoTarget | null {
  const [only] = selection;
  if (selection.length !== 1 || !only) return null;
  return only.collection === 'walls' || only.collection === 'openings'
    ? { collection: only.collection, id: only.id }
    : null;
}

function wallHandles(data: FloorData, id: Id): GizmoHandle[] {
  const wall = data.walls[id];
  if (!wall || wallLength(wall) < EPSILON) return [];
  const height = wall.height ?? data.height;
  const dir = normalize(sub(wall.b, wall.a));
  const normal = leftNormal(dir);
  const mid = scale(add(wall.a, wall.b), 0.5);
  const across: Constraint = { kind: 'axis', dir: flat(normal, 0) };
  return [
    {
      name: 'move-left',
      at: flat(add(mid, scale(normal, wall.thickness / 2)), height / 2),
      constraint: across,
      shape: 'arrow',
    },
    {
      name: 'move-right',
      at: flat(sub(mid, scale(normal, wall.thickness / 2)), height / 2),
      constraint: across,
      shape: 'arrow',
    },
    { name: 'corner-a', at: flat(wall.a, height), constraint: { kind: 'level' }, shape: 'sphere' },
    { name: 'corner-b', at: flat(wall.b, height), constraint: { kind: 'level' }, shape: 'sphere' },
    { name: 'height', at: flat(mid, height), constraint: { kind: 'axis', dir: UP }, shape: 'cube' },
  ];
}

function openingHandles(data: FloorData, id: Id): GizmoHandle[] {
  const opening = data.openings[id];
  const wall = opening && data.walls[opening.wallId];
  if (!opening || !wall) return [];
  const length = wallLength(wall);
  const hole = length < EPSILON ? null : openingHole(opening, length, wall.height ?? data.height);
  if (!hole) return [];
  const dir = normalize(sub(wall.b, wall.a));
  const along = (t: number) => add(wall.a, scale(dir, t));
  const centre = along((hole.start + hole.end) / 2);
  const middle = (hole.bottom + hole.top) / 2;
  const slide: Constraint = { kind: 'axis', dir: flat(dir, 0) };
  const vertical: Constraint = { kind: 'axis', dir: UP };
  const handles: GizmoHandle[] = [
    { name: 'slide', at: flat(centre, middle), constraint: slide, shape: 'arrow' },
    { name: 'start', at: flat(along(hole.start), middle), constraint: slide, shape: 'cube' },
    { name: 'end', at: flat(along(hole.end), middle), constraint: slide, shape: 'cube' },
    { name: 'top', at: flat(centre, hole.top), constraint: vertical, shape: 'cube' },
  ];
  if (opening.kind === 'window')
    handles.push({
      name: 'sill',
      at: flat(centre, hole.bottom),
      constraint: vertical,
      shape: 'cube',
    });
  return handles;
}

/** The handles of the target's gizmo on `data`, or none when the item is missing or has no size. */
export const gizmoHandles = (data: FloorData, target: GizmoTarget): GizmoHandle[] =>
  target.collection === 'walls' ? wallHandles(data, target.id) : openingHandles(data, target.id);

/**
 * A handle as drawn on screen, in CSS pixels: its centre, and the segment a press near grabs it,
 * an arrow's shaft or else just the centre.
 */
export interface ScreenHandle {
  name: HandleName;
  at: Pt;
  from: Pt;
  to: Pt;
}

/**
 * The handle nearest `p` on screen within `reach` pixels of its shape, or null. An arrow counts as
 * half a cube farther away than it is: an opening's edge handles sit on its slide arrow's shaft
 * when the opening is narrow on screen, and a press on an edge handle must not grab the arrow.
 */
export function handleNear(
  handles: readonly ScreenHandle[],
  p: Pt,
  reach: number,
): HandleName | null {
  let best: HandleName | null = null;
  let bestScore = Infinity;
  for (const h of handles) {
    const d = distanceToSegment(p, h.from, h.to);
    const point = h.from.x === h.to.x && h.from.y === h.to.y;
    const score = point ? d : d + HANDLE_PX.cube / 2;
    if (d <= reach && score < bestScore) {
      best = h.name;
      bestScore = score;
    }
  }
  return best;
}
