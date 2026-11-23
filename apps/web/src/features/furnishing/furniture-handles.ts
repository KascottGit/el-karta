import { EPSILON, type Id } from '@el-karta/core';
import { modelStore } from '@/model/store';
import type { CanvasContext, CanvasPointer, Handle } from '@/features/floorplan/canvas/extension';
import { snappingStore } from '@/features/floorplan/snapping/snapping';
import { setDeviceDrag } from '@/features/devices/device-drag';
import { furnishingStore } from './furnishing-store';
import {
  asFurniture,
  movedTo,
  rotationTowards,
  storeFurniture,
  withPlacement,
  type Furniture,
} from './furniture-edits';

/** Degrees the rotation handle snaps to, unless Alt is held or snapping is off. */
export const ROTATION_STEP = 15;

const itemOf = (floorId: Id, id: Id) => {
  const floor = modelStore.getState().model?.floors[floorId];
  const item = asFurniture(floor?.data.devices[id]);
  return floor && item ? { floor, item } : null;
};

const stop = () => {
  furnishingStore.setState({ drag: null });
  setDeviceDrag(null);
};

function moved(id: Id, p: CanvasPointer, ctx: CanvasContext): Furniture | null {
  const drag = furnishingStore.getState().drag;
  const found = itemOf(ctx.floorId, id);
  if (!found || drag?.id !== id || drag.floorId !== ctx.floorId) return null;
  const at = { x: p.world.x - drag.grab.x, y: p.world.y - drag.grab.y };
  return movedTo(found.floor.data, found.item, at);
}

function turned(id: Id, p: CanvasPointer, ctx: CanvasContext): Furniture | null {
  const found = itemOf(ctx.floorId, id);
  if (!found) return null;
  const step = snappingStore.getState().enabled && !p.altKey ? ROTATION_STEP : 0;
  return withPlacement(found.item, {
    rotation: rotationTowards(found.item.placement.at, p.world, step),
  });
}

/** Stores the dragged item if the drag changed it: one undo step per drag. */
function commit(id: Id, next: Furniture | null, ctx: CanvasContext) {
  stop();
  const before = itemOf(ctx.floorId, id)?.item;
  if (!next || !before) return;
  const { at: a, rotation: r = 0 } = before.placement;
  const { at: b, rotation: s = 0 } = next.placement;
  if (Math.hypot(a.x - b.x, a.y - b.y) <= EPSILON && Math.abs(r - s) <= EPSILON) return;
  modelStore.getState().apply(storeFurniture(next));
}

/** A selected piece of furniture, dragged by its body to move it. */
export const furnitureMove: Handle<{ id: Id }> = {
  name: 'furniture-move',
  onDragStart: ({ id }, start, _p, ctx) => {
    const found = itemOf(ctx.floorId, id);
    if (!found) return;
    const { at } = found.item.placement;
    furnishingStore.setState({
      drag: {
        floorId: ctx.floorId,
        id,
        grab: { x: start.world.x - at.x, y: start.world.y - at.y },
      },
    });
  },
  onDrag: ({ id }, p, ctx) => {
    const next = moved(id, p, ctx);
    if (next) setDeviceDrag({ floorId: ctx.floorId, device: next });
  },
  onDragEnd: ({ id }, p, ctx) => {
    commit(id, moved(id, p, ctx), ctx);
  },
  onDragCancel: stop,
};

/** The knob behind a selected piece of furniture, dragged around it to turn it. */
export const furnitureRotate: Handle<{ id: Id }> = {
  name: 'furniture-rotate',
  onDragStart: ({ id }, _start, _p, ctx) => {
    furnishingStore.setState({ drag: { floorId: ctx.floorId, id, grab: { x: 0, y: 0 } } });
  },
  onDrag: ({ id }, p, ctx) => {
    const next = turned(id, p, ctx);
    if (next) setDeviceDrag({ floorId: ctx.floorId, device: next });
  },
  onDragEnd: ({ id }, p, ctx) => {
    commit(id, turned(id, p, ctx), ctx);
  },
  onDragCancel: stop,
};
