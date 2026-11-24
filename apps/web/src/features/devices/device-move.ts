import { EPSILON, type Device, type Id, type Placement, type Pt } from '@el-karta/core';
import { modelStore } from '@/model/store';
import type { CanvasContext, CanvasPointer, Handle } from '@/features/floorplan/canvas/extension';
import { snapTolerance } from '@/features/floorplan/snapping/snapping';
import { setDeviceDrag } from './device-drag';
import { storeDevice } from './device-edits';
import { movedDevice, siteAnchor } from './device-site';

/** Placements whose devices are drawn as markers and moved by `deviceMove`. */
export const isMovableMarker = (device: Pick<Device, 'placement'>): boolean =>
  device.placement.kind === 'wall' || device.placement.kind === 'ceiling';

/** The device being moved and where it was grabbed relative to its marker. UI-only. */
let grabbed: { floorId: Id; id: Id; grab: Pt } | null = null;

const deviceOf = (floorId: Id, id: Id) => {
  const floor = modelStore.getState().model?.floors[floorId];
  const device = floor?.data.devices[id];
  return floor && device ? { floor, device } : null;
};

function moved(id: Id, p: CanvasPointer, ctx: CanvasContext): Device | null {
  const found = deviceOf(ctx.floorId, id);
  if (!found || grabbed?.id !== id || grabbed.floorId !== ctx.floorId) return null;
  const at = { x: p.world.x - grabbed.grab.x, y: p.world.y - grabbed.grab.y };
  return movedDevice(found.floor.data, found.device, at, snapTolerance(p, ctx));
}

const stop = () => {
  grabbed = null;
  setDeviceDrag(null);
};

/** Whether a move left the device where it was. */
const samePlacement = (a: Placement, b: Placement) =>
  (a.kind === 'wall' &&
    b.kind === 'wall' &&
    a.wallId === b.wallId &&
    a.side === b.side &&
    Math.abs(a.offset - b.offset) <= EPSILON) ||
  (a.kind === 'ceiling' &&
    b.kind === 'ceiling' &&
    Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) <= EPSILON);

/**
 * A selected wall or ceiling device, dragged by its marker: along its wall and onto another wall
 * face within reach, or around its room. It previews through `deviceDragStore`, and the drop is
 * one `updateDevice` edit.
 */
export const deviceMove: Handle<{ id: Id }> = {
  name: 'device-move',
  onDragStart: ({ id }, start, _p, ctx) => {
    const found = deviceOf(ctx.floorId, id);
    const anchor = found && siteAnchor(found.floor.data, found.device);
    grabbed = anchor && {
      floorId: ctx.floorId,
      id,
      grab: { x: start.world.x - anchor.x, y: start.world.y - anchor.y },
    };
  },
  onDrag: ({ id }, p, ctx) => {
    const next = moved(id, p, ctx);
    if (next) setDeviceDrag({ floorId: ctx.floorId, device: next });
  },
  onDragEnd: ({ id }, p, ctx) => {
    const next = moved(id, p, ctx);
    const before = deviceOf(ctx.floorId, id)?.device;
    stop();
    if (!next || !before || samePlacement(before.placement, next.placement)) return;
    modelStore.getState().apply(storeDevice(next));
  },
  onDragCancel: stop,
};
