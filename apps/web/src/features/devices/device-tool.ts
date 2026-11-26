import { addDevice, type Device, type Id } from '@el-karta/core';
import { modelStore } from '@/model/store';
import { editorStore } from '@/features/floorplan/editor-store';
import type { CanvasContext, CanvasPointer, Tool } from '@/features/floorplan/canvas/extension';
import { snapTolerance } from '@/features/floorplan/snapping/snapping';
import { newDeviceSite } from './device-site';
import { newDevice, type DeviceSite, type DeviceTypeRef } from './new-device';

/** Where a device tool would place a device, under a hovering mouse or pen. */
export interface DevicePreview {
  floorId: Id;
  device: Device;
}

export interface DeviceToolSpec extends Pick<Tool, 'id' | 'label' | 'icon' | 'order' | 'shortcut'> {
  /** The type to place, chosen in the domain's side panel. */
  chosenType: () => DeviceTypeRef | undefined;
  /** Builds the device at a site; `newDevice` unless the domain has its own constructor. */
  create?: (type: DeviceTypeRef, id: Id, site: DeviceSite) => Device;
  setPreview: (preview: DevicePreview | null) => void;
  /** A tap placed nothing (`missed`), or placed or selected something; for a notice in the panel. */
  setMissed?: (missed: boolean) => void;
}

const PREVIEW_ID = 'device-preview';

/**
 * A tool that places a device of the type chosen in its domain's side panel where it is tapped,
 * following the type's placements (`newDeviceSite`): on the nearest wall face within the snap
 * reach, on the ceiling of the room under the pointer, or on the floor. Nothing is placed where
 * the type cannot go. The new device is selected, so it can be moved straight away; a tap on a
 * device selects it instead.
 */
export function deviceTool(spec: DeviceToolSpec): Tool {
  const { chosenType, create = newDevice, setPreview, setMissed, ...button } = spec;

  const deviceAt = (p: CanvasPointer, ctx: CanvasContext, id: Id): Device | null => {
    const floor = modelStore.getState().model?.floors[ctx.floorId];
    const type = chosenType();
    if (!floor || !type) return null;
    const site = newDeviceSite(floor.data, type.def, p.world, snapTolerance(p, ctx));
    return site && create(type, id, site);
  };
  const onDevice = (p: CanvasPointer, ctx: CanvasContext) => {
    const hit = ctx.itemAt(p.screen, p.kind);
    return hit?.collection === 'devices' ? hit : null;
  };
  const clearPreview = () => {
    setPreview(null);
  };

  return {
    ...button,
    cursor: 'crosshair',
    onHover: (p, ctx) => {
      const device = onDevice(p, ctx) ? null : deviceAt(p, ctx, PREVIEW_ID);
      setPreview(device && { floorId: ctx.floorId, device });
    },
    onTap: (p, ctx) => {
      const hit = onDevice(p, ctx);
      setMissed?.(false);
      if (hit) {
        editorStore.getState().select([hit]);
        return;
      }
      const device = deviceAt(p, ctx, crypto.randomUUID());
      if (!device) {
        setMissed?.(true);
        return;
      }
      clearPreview();
      modelStore.getState().apply(addDevice(ctx.floorId, device));
      editorStore.getState().select([{ collection: 'devices', id: device.id }]);
    },
    onLeave: clearPreview,
    onDeactivate: () => {
      clearPreview();
      setMissed?.(false);
    },
  };
}
