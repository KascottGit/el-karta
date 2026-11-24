import { addDevice, roomAt, type Device, type Id, type Pt } from '@el-karta/core';
import { newFurniture } from '@el-karta/plugin-furnishing';
import { Sofa } from 'lucide-react';
import { modelStore } from '@/model/store';
import { editorStore } from '@/features/floorplan/editor-store';
import type { CanvasContext, CanvasPointer, Tool } from '@/features/floorplan/canvas/extension';
import { furnishingStore } from './furnishing-store';

const PREVIEW_ID = 'furniture-preview';

/** A new item of the chosen type centred at `at`, in the room it stands in. */
function furnitureAt(ctx: CanvasContext, at: Pt, id: Id): Device | null {
  const floor = modelStore.getState().model?.floors[ctx.floorId];
  if (!floor) return null;
  const { type } = furnishingStore.getState();
  return newFurniture({ id, type, at, roomId: roomAt(floor.data, at) });
}

const clearPreview = () => {
  furnishingStore.setState({ preview: null });
};

const onItem = (p: CanvasPointer, ctx: CanvasContext) => ctx.itemAt(p.screen, p.kind);

/**
 * Places a piece of furniture of the type chosen in the side panel, centred where it is tapped,
 * and selects it so it can be moved and turned straight away. A tap on a device selects it instead.
 */
export const furnitureTool: Tool = {
  id: 'furniture',
  label: 'furnishing.tool',
  icon: Sofa,
  order: 40,
  shortcut: 'u',
  cursor: 'crosshair',
  onHover: (p, ctx) => {
    const device =
      onItem(p, ctx)?.collection === 'devices' ? null : furnitureAt(ctx, p.world, PREVIEW_ID);
    furnishingStore.setState({ preview: device && { floorId: ctx.floorId, device } });
  },
  onTap: (p, ctx) => {
    const hit = onItem(p, ctx);
    if (hit?.collection === 'devices') {
      editorStore.getState().select([hit]);
      return;
    }
    const device = furnitureAt(ctx, p.world, crypto.randomUUID());
    if (!device) return;
    clearPreview();
    modelStore.getState().apply(addDevice(ctx.floorId, device));
    editorStore.getState().select([{ collection: 'devices', id: device.id }]);
  },
  onLeave: clearPreview,
  onDeactivate: clearPreview,
};
