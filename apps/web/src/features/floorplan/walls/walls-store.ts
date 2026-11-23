import type { Id, Pt, Snap, Wall } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { EndRef } from './corner';
import type { WallMovePlan } from './move-wall';

export const WALL_THICKNESS = { interior: 0.12, exterior: 0.3 } as const;

interface DragBase {
  floorId: Id;
  /** Stable for the whole drag, so the walls layer re-renders only when the drag starts and ends. */
  moving: ReadonlySet<Id>;
  /** The walls in `moving`, drawn from here instead of the model meanwhile. */
  preview: readonly Wall[];
}

/** A corner being dragged. */
export interface CornerDrag extends DragBase {
  kind: 'corner';
  /** Where the corner was when the drag started. */
  origin: Pt;
  ends: readonly EndRef[];
}

/** A wall being moved along its normal. */
export interface WallMoveDrag extends DragBase {
  kind: 'move';
  plan: WallMovePlan;
  /** How far along the normal from the wall's centre line it was grabbed, in metres. */
  grab: number;
}

export type WallDrag = CornerDrag | WallMoveDrag;

/**
 * UI state of the walls feature, never saved or undone: settings for new walls (kept for the
 * session) and previews of the snap target and a corner or wall being dragged.
 */
export interface WallsState {
  thickness: number;
  /** The floor the polyline in the editor store's `drawing` belongs to, so it is committed there. */
  drawingFloorId: Id | null;
  snap: Snap | null;
  drag: WallDrag | null;
}

export const wallsStore = createStore<WallsState>()(() => ({
  thickness: WALL_THICKNESS.interior,
  drawingFloorId: null,
  snap: null,
  drag: null,
}));

export const useWallsStore = <T>(selector: (state: WallsState) => T): T =>
  useStore(wallsStore, selector);
