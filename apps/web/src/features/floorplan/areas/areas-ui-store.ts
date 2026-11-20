import type { Id, Pt, Snap } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { MessageKey } from '../canvas/extension';
import type { AreaCollection } from './area-edits';

const NOTICE_MS = 5000;

/** Preview state of the area tools and handles. UI-only, like the editor store. */
export interface AreasUiState {
  /** Where the pointer snapped to, for the marker. */
  snap: Snap | null;
  /** The room the fill tool would create at the pointer. */
  fill: readonly Pt[] | null;
  /** The polygon being reshaped by a vertex or midpoint drag, drawn instead of the stored one. */
  drag: { collection: AreaCollection; id: Id; polygon: readonly Pt[] } | null;
  /**
   * The floor the polygon in the editor store's `drawing` belongs to, so it is committed there even
   * when a floor switch ends the drawing.
   */
  drawingFloorId: Id | null;
  /** Why the last action did nothing. */
  notice: MessageKey | null;
}

export const areasUiStore = createStore<AreasUiState>()(() => ({
  snap: null,
  fill: null,
  drag: null,
  drawingFloorId: null,
  notice: null,
}));

export const useAreasUi = <T>(selector: (state: AreasUiState) => T): T =>
  useStore(areasUiStore, selector);

/** Drops the previews; a notice stays until it times out or the next action. */
export function resetAreasPreview() {
  areasUiStore.setState({ snap: null, fill: null, drag: null, drawingFloorId: null });
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export function showNotice(notice: MessageKey) {
  clearTimeout(noticeTimer);
  areasUiStore.setState({ notice });
  noticeTimer = setTimeout(() => {
    if (areasUiStore.getState().notice === notice) areasUiStore.setState({ notice: null });
  }, NOTICE_MS);
}

export function clearNotice() {
  clearTimeout(noticeTimer);
  areasUiStore.setState({ notice: null });
}
