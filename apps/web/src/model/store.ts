import {
  applyEdit,
  splitByDocument,
  type Change,
  type DocumentKey,
  type Edit,
  type Model,
} from '@el-karta/core';
import { applyPatches, type Patch } from 'immer';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

const HISTORY_LIMIT = 200;

interface HistoryEntry {
  patches: Patch[];
  inversePatches: Patch[];
}

export interface ModelState {
  model: Model | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Unsaved changes per stored document, oldest first. Undo and redo are queued as changes too. */
  pending: Readonly<Record<DocumentKey, Change[]>>;
  load: (model: Model) => void;
  apply: (edit: Edit) => void;
  undo: () => void;
  redo: () => void;
}

function enqueue(pending: ModelState['pending'], patches: readonly Patch[]): ModelState['pending'] {
  const next = { ...pending };
  for (const [doc, docPatches] of splitByDocument(patches)) {
    next[doc] = [...(next[doc] ?? []), { id: crypto.randomUUID(), patches: docPatches }];
  }
  return next;
}

export function createModelStore() {
  return createStore<ModelState>()((set, get) => {
    const requireModel = () => {
      const { model } = get();
      if (!model) throw new Error('No project loaded');
      return model;
    };

    return {
      model: null,
      past: [],
      future: [],
      pending: {},

      load: (model) => {
        set({ model, past: [], future: [], pending: {} });
      },

      apply: (edit) => {
        const { model, patches, inversePatches } = applyEdit(requireModel(), edit);
        if (patches.length === 0) return;
        set((s) => ({
          model,
          past: [...s.past, { patches, inversePatches }].slice(-HISTORY_LIMIT),
          future: [],
          pending: enqueue(s.pending, patches),
        }));
      },

      undo: () => {
        const entry = get().past.at(-1);
        if (!entry) return;
        set((s) => ({
          model: applyPatches(requireModel(), entry.inversePatches),
          past: s.past.slice(0, -1),
          future: [...s.future, entry],
          pending: enqueue(s.pending, entry.inversePatches),
        }));
      },

      redo: () => {
        const entry = get().future.at(-1);
        if (!entry) return;
        set((s) => ({
          model: applyPatches(requireModel(), entry.patches),
          past: [...s.past, entry],
          future: s.future.slice(0, -1),
          pending: enqueue(s.pending, entry.patches),
        }));
      },
    };
  });
}

export const modelStore = createModelStore();

export const useModelStore = <T>(selector: (state: ModelState) => T): T =>
  useStore(modelStore, selector);
