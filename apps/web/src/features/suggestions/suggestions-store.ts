import type { Id } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { MessageKey } from '@/features/floorplan/canvas/extension';
import { demoSource, DEMO_PARAM } from './dev-seed';
import type { Ghost } from './ghosts';
import type { SuggestionSource } from './source';
import { supabaseSource } from './supabase-source';

/** A value that belongs to one floor, so switching floors never shows another floor's. */
interface OnFloor<T> {
  floorId: Id;
  value: T;
}

interface SuggestionsState {
  source: SuggestionSource;
  /** The suggestion tapped on the canvas or picked in the list. */
  selected: OnFloor<Id> | null;
  /** The drawn ghosts, published by the layer for the tool's hit test. */
  ghosts: OnFloor<Readonly<Record<Id, Ghost>>> | null;
  /** The last failure, shown in the panel until the next decision. */
  notice: OnFloor<MessageKey> | null;
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
  notice: null,
}));

export const useSuggestions = <T>(selector: (state: SuggestionsState) => T): T =>
  useStore(suggestionsStore, selector);

/** Switches to another source, e.g. an in-memory one in tests. */
export const setSuggestionSource = (source: SuggestionSource) => {
  suggestionsStore.setState({ source, selected: null, ghosts: null, notice: null });
};

export const selectSuggestion = (floorId: Id, id: Id | null) => {
  suggestionsStore.setState({ selected: id === null ? null : { floorId, value: id } });
};

export const publishGhosts = (floorId: Id, ghosts: Readonly<Record<Id, Ghost>>) => {
  suggestionsStore.setState({ ghosts: { floorId, value: ghosts } });
};

export const setNotice = (floorId: Id, notice: MessageKey | null) => {
  suggestionsStore.setState({ notice: notice === null ? null : { floorId, value: notice } });
};

/** The value if it belongs to `floorId`. */
export const onFloor = <T>(item: OnFloor<T> | null, floorId: Id): T | null =>
  item?.floorId === floorId ? item.value : null;
