import type { PowerType } from '@el-karta/plugin-power';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { DevicePreview } from '@/features/devices/device-tool';

/** UI state of the power tool, never saved or undone. */
export interface PowerState {
  /** What the power tool places. */
  type: PowerType;
  /** Where the power tool would place a device, under a hovering mouse or pen. */
  preview: DevicePreview | null;
  /** The last tap placed nothing: away from every wall, or outside every room. */
  missed: boolean;
}

export const powerStore = createStore<PowerState>()(() => ({
  type: 'outlet',
  preview: null,
  missed: false,
}));

export const usePowerStore = <T>(selector: (state: PowerState) => T): T =>
  useStore(powerStore, selector);
