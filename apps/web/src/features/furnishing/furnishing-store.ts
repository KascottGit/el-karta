import type { Device, Id, Pt } from '@el-karta/core';
import type { FurnitureType } from '@el-karta/plugin-furnishing';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** UI state of the furniture tool and handles, never saved or undone. */
export interface FurnishingState {
  /** What the furniture tool places. */
  type: FurnitureType;
  /** Where the furniture tool would place an item, under a hovering mouse or pen. */
  preview: { floorId: Id; device: Device } | null;
  /** The item being moved or turned, and where it was grabbed relative to its centre. */
  drag: { floorId: Id; id: Id; grab: Pt } | null;
}

export const furnishingStore = createStore<FurnishingState>()(() => ({
  type: 'desk',
  preview: null,
  drag: null,
}));

export const useFurnishingStore = <T>(selector: (state: FurnishingState) => T): T =>
  useStore(furnishingStore, selector);
