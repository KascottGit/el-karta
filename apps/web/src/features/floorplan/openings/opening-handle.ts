import { EPSILON, putSpaceItem, type Id } from '@el-karta/core';
import { modelStore } from '@/model/store';
import type { CanvasContext, CanvasPointer, Handle } from '../canvas/extension';
import { openingsStore } from './openings-store';
import { offsetAlong, slideOpening } from './placement';

const floorOf = (floorId: Id) => modelStore.getState().model?.floors[floorId];

/** The dragged opening at the pointer, or null if the drag or its wall is gone. */
function slid(id: Id, p: CanvasPointer, ctx: CanvasContext) {
  const drag = openingsStore.getState().drag;
  const floor = floorOf(ctx.floorId);
  const opening = floor?.data.openings[id];
  if (!floor || !opening || drag?.floorId !== ctx.floorId || drag.id !== id) return null;
  return { drag, opening, moved: slideOpening(floor.data, opening, drag.grab, p.world) ?? opening };
}

const stop = () => {
  openingsStore.setState({ drag: null });
};

/**
 * An opening, dragged along its own wall. It stays within the wall's ends and is nudged beside
 * other openings rather than over them. The move is one undoable edit.
 */
export const openingSlide: Handle<{ id: Id }> = {
  name: 'opening-slide',
  onDragStart: ({ id }, start, _p, ctx) => {
    const floor = floorOf(ctx.floorId);
    const opening = floor?.data.openings[id];
    const wall = opening && floor.data.walls[opening.wallId];
    if (!opening || !wall) return;
    openingsStore.setState({
      drag: {
        floorId: ctx.floorId,
        id,
        grab: offsetAlong(wall, start.world) - opening.offset,
        opening,
      },
    });
  },
  onDrag: ({ id }, p, ctx) => {
    const t = slid(id, p, ctx);
    if (t) openingsStore.setState({ drag: { ...t.drag, opening: t.moved } });
  },
  onDragEnd: ({ id }, p, ctx) => {
    const t = slid(id, p, ctx);
    stop();
    if (t && Math.abs(t.moved.offset - t.opening.offset) > EPSILON)
      modelStore.getState().apply(putSpaceItem(ctx.floorId, 'openings', t.moved));
  },
  onDragCancel: stop,
};
