import type { Id, Pt } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { MessageKey } from '../canvas/extension';
import type { AreaCollection } from './area-edits';

const NOTICE_MS = 4000;

/** Preview state of the area tools and handles. UI-only, like the editor store. */
export interface AreasUiState {
  /** Where the pointer snapped to, for a marker. */
  snap: Pt | null;
  /** The room the fill tool would create at the pointer. */
  fill: readonly Pt[] | null;
  /** The polygon being reshaped by a vertex or midpoint drag, drawn instead of the stored one. */
  drag: { collection: AreaCollection; id: Id; polygon: readonly Pt[] } | null;
  /** Why the last action did nothing, shown next to where it happened. */
  notice: { at: Pt; message: MessageKey } | null;
}

const IDLE: AreasUiState = { snap: null, fill: null, drag: null, notice: null };

export const areasUiStore = createStore<AreasUiState>()(() => IDLE);

export const useAreasUi = <T>(selector: (state: AreasUiState) => T): T =>
  useStore(areasUiStore, selector);

export function resetAreasUi() {
  areasUiStore.setState(IDLE);
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export function showNotice(at: Pt, message: MessageKey) {
  clearTimeout(noticeTimer);
  const notice = { at, message };
  areasUiStore.setState({ notice });
  noticeTimer = setTimeout(() => {
    if (areasUiStore.getState().notice === notice) areasUiStore.setState({ notice: null });
  }, NOTICE_MS);
}
