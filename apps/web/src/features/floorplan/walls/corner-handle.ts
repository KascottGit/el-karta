import { distance, EPSILON, type Id } from '@el-karta/core';
import { modelStore } from '@/model/store';
import type { CanvasContext, CanvasPointer, Handle } from '../canvas/extension';
import { cornerAt, fixedEnds, moveEnds, putWalls } from './corner';
import { snapPointer } from './snapping';
import type { WallEnd } from './wall-outline';
import { wallsStore } from './walls-store';

const wallsOf = (floorId: Id) => modelStore.getState().model?.floors[floorId]?.data.walls;

/** The dragged corner snapped like a new point, with angle steps from the moving walls' far ends. */
function target(p: CanvasPointer, ctx: CanvasContext) {
  const walls = wallsOf(ctx.floorId);
  const drag = wallsStore.getState().drag;
  if (!walls || drag?.floorId !== ctx.floorId) return null;
  const snap = snapPointer(p, ctx, { from: fixedEnds(walls, drag.ends), ignore: drag.moving });
  return { walls, drag, snap, moved: moveEnds(walls, drag.ends, snap.point) };
}

function stop() {
  wallsStore.setState({ drag: null, snap: null });
}

/**
 * A wall end. Dragging it moves every wall end at that corner and commits the move as one
 * undoable edit. A drop that would leave a wall without length is ignored.
 */
export const cornerHandle: Handle<{ wallId: Id; end: WallEnd }> = {
  name: 'wall-corner',
  onDragStart: ({ wallId, end }, _start, _p, ctx) => {
    const walls = wallsOf(ctx.floorId);
    const origin = walls?.[wallId]?.[end];
    if (!walls || !origin) return;
    const ends = cornerAt(walls, origin);
    wallsStore.setState({
      drag: {
        floorId: ctx.floorId,
        origin,
        ends,
        moving: new Set(ends.map((e) => e.wallId)),
        preview: ends.flatMap((e) => walls[e.wallId] ?? []),
      },
    });
  },
  onDrag: (_payload, p, ctx) => {
    const t = target(p, ctx);
    if (!t) return;
    wallsStore.setState({
      snap: t.snap,
      drag: t.moved ? { ...t.drag, preview: t.moved } : t.drag,
    });
  },
  onDragEnd: (_payload, p, ctx) => {
    const t = target(p, ctx);
    stop();
    if (t?.moved && distance(t.snap.point, t.drag.origin) > EPSILON)
      modelStore.getState().apply(putWalls(ctx.floorId, t.moved));
  },
  onDragCancel: stop,
};
