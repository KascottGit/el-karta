import type { Id, Opening } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { MessageKey } from '../canvas/extension';

/** An opening being slid along its wall, drawn from `opening` instead of the model meanwhile. */
export interface OpeningDrag {
  floorId: Id;
  id: Id;
  /** Metres from the opening's near edge to the point grabbed. */
  grab: number;
  opening: Opening;
}

/** UI state of the openings feature, never saved or undone. */
export interface OpeningsState {
  /** Where the active opening tool would place an opening. */
  preview: { floorId: Id; opening: Opening } | null;
  drag: OpeningDrag | null;
  /** Why the last tap placed nothing. */
  notice: MessageKey | null;
}

export const openingsStore = createStore<OpeningsState>()(() => ({
  preview: null,
  drag: null,
  notice: null,
}));

export const useOpeningsStore = <T>(selector: (state: OpeningsState) => T): T =>
  useStore(openingsStore, selector);
