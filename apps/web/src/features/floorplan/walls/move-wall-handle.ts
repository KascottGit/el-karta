import { dot, EPSILON, scale, sub, type Id } from '@el-karta/core';
import { modelStore } from '@/model/store';
import type { CanvasContext, CanvasPointer, Handle } from '../canvas/extension';
import { snapPointer } from '../snapping/snapping';
import { putWalls } from './corner';
import { applyWallMove, planWallMove } from './move-wall';
import { wallsStore } from './walls-store';

const wallsOf = (floorId: Id) => modelStore.getState().model?.floors[floorId]?.data.walls;

/** Starts moving a wall along its normal from where it was grabbed. False if there is no such wall. */
export function startWallMove(wallId: Id, start: CanvasPointer, ctx: CanvasContext): boolean {
  const walls = wallsOf(ctx.floorId);
  const plan = walls && planWallMove(walls, wallId);
  if (!walls || !plan) return false;
  wallsStore.setState({
    drag: {
      kind: 'move',
      floorId: ctx.floorId,
      plan,
      grab: dot(sub(start.world, plan.wall.a), plan.normal),
      moving: plan.moving,
      preview: [...plan.moving].flatMap((id) => walls[id] ?? []),
    },
  });
  return true;
}

/**
 * The offset along the normal that puts the wall's centre line where the pointer drags it, snapped
 * so the line passes through a snap target (the pointer is moved back to the line by the grab
 * offset and snapped there, and the snapped point projected on the normal).
 */
function target(p: CanvasPointer, ctx: CanvasContext) {
  const walls = wallsOf(ctx.floorId);
  const drag = wallsStore.getState().drag;
  if (!walls || drag?.kind !== 'move' || drag.floorId !== ctx.floorId) return null;
  const { wall, normal } = drag.plan;
  const onLine = sub(p.world, scale(normal, drag.grab));
  const snap = snapPointer({ ...p, world: onLine }, ctx, { ignore: drag.moving });
  const offset = dot(sub(snap.point, wall.a), normal);
  return { drag, snap, offset, moved: applyWallMove(walls, drag.plan, offset) };
}

export function dragWallMove(p: CanvasPointer, ctx: CanvasContext) {
  const t = target(p, ctx);
  if (!t) return;
  wallsStore.setState({ snap: t.snap, drag: t.moved ? { ...t.drag, preview: t.moved } : t.drag });
}

export function cancelWallMove() {
  if (wallsStore.getState().drag?.kind === 'move') wallsStore.setState({ drag: null, snap: null });
}

/** Commits the move as one undoable edit. A drop that would leave a wall too short is ignored. */
export function endWallMove(p: CanvasPointer, ctx: CanvasContext) {
  const t = target(p, ctx);
  cancelWallMove();
  if (t?.moved && Math.abs(t.offset) > EPSILON)
    modelStore.getState().apply(putWalls(ctx.floorId, t.moved));
}

/** A selected wall's body and the double arrow across its middle: dragging either moves the wall. */
export const wallMoveHandle: Handle<{ wallId: Id }> = {
  name: 'wall-move',
  onDragStart: ({ wallId }, start, _p, ctx) => {
    startWallMove(wallId, start, ctx);
  },
  onDrag: (_payload, p, ctx) => {
    dragWallMove(p, ctx);
  },
  onDragEnd: (_payload, p, ctx) => {
    endWallMove(p, ctx);
  },
  onDragCancel: cancelWallMove,
};
