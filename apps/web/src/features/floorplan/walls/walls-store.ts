import type { Id, Pt, Snap, Wall } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { EndRef } from './corner';

export const WALL_THICKNESS = { interior: 0.12, exterior: 0.3 } as const;

/** A corner being dragged: the walls it moves, drawn from `preview` instead of the model meanwhile. */
export interface CornerDrag {
  floorId: Id;
  /** Where the corner was when the drag started. */
  origin: Pt;
  ends: readonly EndRef[];
  /** Stable for the whole drag, so the walls layer re-renders only when the drag starts and ends. */
  moving: ReadonlySet<Id>;
  preview: readonly Wall[];
}

/**
 * UI state of the walls feature, never saved or undone: settings for new walls (kept for the
 * session) and previews of the snap target and a corner being dragged.
 */
export interface WallsState {
  thickness: number;
  /** The floor the polyline in the editor store's `drawing` belongs to, so it is committed there. */
  drawingFloorId: Id | null;
  snap: Snap | null;
  drag: CornerDrag | null;
}

export const wallsStore = createStore<WallsState>()(() => ({
  thickness: WALL_THICKNESS.interior,
  drawingFloorId: null,
  snap: null,
  drag: null,
}));

export const useWallsStore = <T>(selector: (state: WallsState) => T): T =>
  useStore(wallsStore, selector);
