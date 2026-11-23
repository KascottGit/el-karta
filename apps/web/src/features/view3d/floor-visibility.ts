import type { FloorRecord, Id, Model } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** Which floors the 3D view shows: the editor's floor, all floors, or a chosen set. */
export type FloorChoice =
  { kind: 'current' } | { kind: 'all' } | { kind: 'some'; ids: readonly Id[] };

export interface View3dState {
  floors: FloorChoice;
  exploded: boolean;
  /** Bumped to ask the view to zoom to fit the visible floors. */
  fitRequest: number;
  setFloors: (floors: FloorChoice) => void;
  setExploded: (exploded: boolean) => void;
  requestFit: () => void;
}

export function createView3dStore() {
  return createStore<View3dState>()((set) => ({
    floors: { kind: 'current' },
    exploded: false,
    fitRequest: 0,
    setFloors: (floors) => {
      set({ floors });
    },
    setExploded: (exploded) => {
      set({ exploded });
    },
    requestFit: () => {
      set((s) => ({ fitRequest: s.fitRequest + 1 }));
    },
  }));
}

/** UI state of the 3D view; kept while the view is closed and reopened. */
export const view3dStore = createView3dStore();

export const useView3dStore = <T>(selector: (state: View3dState) => T): T =>
  useStore(view3dStore, selector);

/** The floors of the current floor's building, bottom first. */
export const buildingFloors = (model: Model, currentId: Id): FloorRecord[] => {
  const buildingId = model.floors[currentId]?.buildingId;
  return Object.values(model.floors)
    .filter((f) => f.buildingId === buildingId)
    .sort((a, b) => a.data.elevation - b.data.elevation || a.sortOrder - b.sortOrder);
};

/**
 * The floors to draw, bottom first. Only floors of the current floor's building, since buildings
 * do not share a coordinate system; a choice that leaves none shows the current floor.
 */
export function visibleFloors(model: Model, currentId: Id, choice: FloorChoice): FloorRecord[] {
  const floors = buildingFloors(model, currentId);
  const chosen =
    choice.kind === 'all'
      ? floors
      : choice.kind === 'some'
        ? floors.filter((f) => choice.ids.includes(f.id))
        : [];
  if (chosen.length > 0) return chosen;
  const current = model.floors[currentId];
  return current ? [current] : [];
}
