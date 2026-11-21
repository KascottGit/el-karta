import type { Id } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { MessageKey } from '@/features/floorplan/canvas/extension';
import { editorStore } from '@/features/floorplan/editor-store';
import type { ModelState } from '@/model/store';
import type { SuggestionDeps } from './actions';
import { demoSource, DEMO_PARAM } from './dev-seed';
import type { Ghost } from './ghosts';
import type { SuggestionSource } from './source';
import { supabaseSource } from './supabase-source';

/** A value that belongs to one floor, so switching floors never shows another floor's. */
interface OnFloor<T> {
  floorId: Id;
  value: T;
}

/** An accept whose undo history entry is watched, so undo and redo change the rows' status too. */
export interface TrackedAccept {
  entry: ModelState['past'][number];
  floorId: Id;
  ids: readonly Id[];
  deps: SuggestionDeps;
}

interface SuggestionsState {
  source: SuggestionSource;
  /** The suggestion tapped on the canvas or picked in the list. */
  selected: OnFloor<Id> | null;
  /** The drawn ghosts, published by the layer for the tool's hit test. */
  ghosts: OnFloor<Readonly<Record<Id, Ghost>>> | null;
  /** How many suggestions of the floor are pending, published by the layer. */
  pending: OnFloor<number> | null;
  /** The last failure, shown in the panel until the next decision. */
  notice: OnFloor<MessageKey> | null;
  /** Accepts whose history entry is still in the model store's past or future. */
  accepts: readonly TrackedAccept[];
}

const initialSource = (): SuggestionSource =>
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has(DEMO_PARAM)
    ? demoSource()
    : supabaseSource;

export const suggestionsStore = createStore<SuggestionsState>()(() => ({
  source: initialSource(),
  selected: null,
  ghosts: null,
  pending: null,
  notice: null,
  accepts: [],
}));

export const useSuggestions = <T>(selector: (state: SuggestionsState) => T): T =>
  useStore(suggestionsStore, selector);

/** Switches to another source, e.g. an in-memory one in tests. */
export const setSuggestionSource = (source: SuggestionSource) => {
  suggestionsStore.setState({
    source,
    selected: null,
    ghosts: null,
    pending: null,
    notice: null,
  });
};

export const selectSuggestion = (floorId: Id, id: Id | null) => {
  suggestionsStore.setState({ selected: id === null ? null : { floorId, value: id } });
};

export const publishGhosts = (
  floorId: Id,
  ghosts: Readonly<Record<Id, Ghost>>,
  pending: number,
) => {
  const before = suggestionsStore.getState().pending;
  suggestionsStore.setState({
    ghosts: { floorId, value: ghosts },
    pending: { floorId, value: pending },
  });
  // Panels' `visible` reads only the editor and model stores, so the side panel re-checks it when
  // the editor store notifies; this lets the review prompt appear once suggestions have loaded.
  if (before?.floorId !== floorId || before.value !== pending) editorStore.setState({});
};

export const setNotice = (floorId: Id, notice: MessageKey | null) => {
  suggestionsStore.setState({ notice: notice === null ? null : { floorId, value: notice } });
};

/** The value if it belongs to `floorId`. */
export const onFloor = <T>(item: OnFloor<T> | null, floorId: Id): T | null =>
  item?.floorId === floorId ? item.value : null;
