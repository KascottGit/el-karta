import type { Device, Id } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * A device being moved, turned or otherwise dragged. While it lasts the devices layer hides the
 * device and `DraggedDevice` draws `device` on the overlays. UI-only, never saved or undone.
 */
export interface DeviceDrag {
  floorId: Id;
  device: Device;
}

export const deviceDragStore = createStore<{ drag: DeviceDrag | null }>()(() => ({ drag: null }));

export const setDeviceDrag = (drag: DeviceDrag | null) => {
  deviceDragStore.setState({ drag });
};

/** The preview of the device being dragged on this floor, or null. */
export const useDraggedDevice = (floorId: Id): Device | null =>
  useStore(deviceDragStore, (s) => (s.drag?.floorId === floorId ? s.drag.device : null));
