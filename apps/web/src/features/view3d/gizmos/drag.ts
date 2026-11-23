import {
  add,
  combine,
  dot,
  putSpaceItem,
  scale,
  snapPoint,
  sub,
  type Edit,
  type FloorData,
  type Id,
  type Opening,
  type Pt,
  type Wall,
} from '@el-karta/core';
import {
  moveOpeningEdge,
  openingFrame,
  setOpeningSill,
  setOpeningTop,
  slideOpeningTo,
  toCentimetres,
} from '@/features/floorplan/openings/resize';
import { cornerAt, fixedEnds, moveEnds, putWalls } from '@/features/floorplan/walls/corner';
import { applyWallMove, planWallMove } from '@/features/floorplan/walls/move-wall';
import type { GizmoTarget, HandleName } from './handles';

/** The lowest a wall can be made with its height handle. */
export const MIN_WALL_HEIGHT = 0.1;

/**
 * How far the pointer has dragged a handle since the press: metres along its axis, or the shift in
 * the horizontal plane for a corner.
 */
export type DragAmount = { kind: 'axis'; along: number } | { kind: 'level'; shift: Pt };

export interface DragOptions {
  /** Snap reach in metres at the handle, or null when snapping is off or Alt is held. */
  snap: number | null;
  /** Round sizes and positions of openings and the wall height to whole centimetres. */
  round: boolean;
}

/** The items a gizmo drag changes, ready to preview or commit. */
export type GizmoChange =
  | { collection: 'walls'; items: readonly Wall[] }
  | { collection: 'openings'; items: readonly Opening[] };

/** A gizmo drag in progress: what was grabbed, and the item as it was when the drag started. */
export interface GizmoDrag {
  target: GizmoTarget;
  handle: HandleName;
  /** The change for a drag of `amount` on the floor's committed data, or null when it is refused. */
  change: (data: FloorData, amount: DragAmount, options: DragOptions) => GizmoChange | null;
}

const alongOf = (amount: DragAmount) => (amount.kind === 'axis' ? amount.along : 0);
const shiftOf = (amount: DragAmount): Pt =>
  amount.kind === 'level' ? amount.shift : { x: 0, y: 0 };
const walls = (items: Wall[] | null): GizmoChange | null => items && { collection: 'walls', items };
const opening = (item: Opening | null): GizmoChange | null =>
  item && { collection: 'openings', items: [item] };

function wallDrag(data: FloorData, wallId: Id, handle: HandleName): GizmoDrag['change'] | null {
  const wall = data.walls[wallId];
  if (!wall) return null;
  switch (handle) {
    case 'move-left':
    case 'move-right': {
      const plan = planWallMove(data.walls, wallId);
      if (!plan) return null;
      const mid = scale(add(wall.a, wall.b), 0.5);
      // As in 2D: the offset puts the wall's centre line through a snap target within reach.
      return (now, amount, { snap }) => {
        const offset = alongOf(amount);
        const line = add(mid, scale(plan.normal, offset));
        const snapped =
          snap === null
            ? line
            : snapPoint(now, line, { tolerance: snap, ignore: plan.moving }).point;
        return walls(applyWallMove(now.walls, plan, dot(sub(snapped, wall.a), plan.normal)));
      };
    }
    case 'corner-a':
    case 'corner-b': {
      const origin = handle === 'corner-a' ? wall.a : wall.b;
      const ends = cornerAt(data.walls, origin);
      const moving = new Set(ends.map((e) => e.wallId));
      const from = fixedEnds(data.walls, ends);
      return (now, amount, { snap }) => {
        const to = add(origin, shiftOf(amount));
        const snapped =
          snap === null ? to : snapPoint(now, to, { tolerance: snap, from, ignore: moving }).point;
        return walls(moveEnds(now.walls, ends, snapped));
      };
    }
    case 'height': {
      const start = wall.height ?? data.height;
      return (now, amount, { round }) => {
        const current = now.walls[wallId];
        if (!current) return null;
        const wanted = start + alongOf(amount);
        const height = Math.max(MIN_WALL_HEIGHT, round ? toCentimetres(wanted) : wanted);
        return walls([{ ...current, height }]);
      };
    }
    default:
      return null;
  }
}

function openingDrag(
  data: FloorData,
  openingId: Id,
  handle: HandleName,
): GizmoDrag['change'] | null {
  const start = data.openings[openingId];
  if (!start) return null;
  const sill = start.sill ?? 0;
  const anchor: Partial<Record<HandleName, number>> = {
    slide: start.offset,
    start: start.offset,
    end: start.offset + start.width,
    top: sill + start.height,
    sill,
  };
  const from = anchor[handle];
  if (from === undefined || (handle === 'sill' && start.kind !== 'window')) return null;
  return (now, amount, { round }) => {
    const current = now.openings[openingId];
    const frame = current && openingFrame(now, current);
    if (!current || !frame) return null;
    const to = from + alongOf(amount);
    switch (handle) {
      case 'slide':
        return opening(slideOpeningTo(frame, current, to, round));
      case 'start':
      case 'end':
        return opening(moveOpeningEdge(frame, current, handle, to, round));
      case 'top':
        return opening(setOpeningTop(frame, current, to, round));
      default:
        return opening(setOpeningSill(frame, current, to, round));
    }
  };
}

/** Starts dragging one handle of a gizmo on the floor's committed data, or null if it has no such handle. */
export function startGizmoDrag(
  data: FloorData,
  target: GizmoTarget,
  handle: HandleName,
): GizmoDrag | null {
  const change =
    target.collection === 'walls'
      ? wallDrag(data, target.id, handle)
      : openingDrag(data, target.id, handle);
  return change && { target, handle, change };
}

/**
 * The floor data with the change put in, for the live preview. Only the changed collection is a new
 * object, so the preview costs one floor rebuild and nothing else (ADR 0009).
 */
export function previewFloor(data: FloorData, change: GizmoChange): FloorData {
  if (change.collection === 'walls') {
    const next = { ...data.walls };
    for (const w of change.items) next[w.id] = w;
    return { ...data, walls: next };
  }
  const next = { ...data.openings };
  for (const o of change.items) next[o.id] = o;
  return { ...data, openings: next };
}

/** Whether the change leaves any item different from the committed data. */
export function changes(data: FloorData, change: GizmoChange): boolean {
  const committed: Readonly<Record<Id, unknown>> =
    change.collection === 'walls' ? data.walls : data.openings;
  return change.items.some((item) => JSON.stringify(committed[item.id]) !== JSON.stringify(item));
}

/** The one edit that commits the change. */
export const changeEdit = (floorId: Id, change: GizmoChange): Edit =>
  change.collection === 'walls'
    ? putWalls(floorId, change.items)
    : combine(...change.items.map((o) => putSpaceItem(floorId, 'openings', o)));
