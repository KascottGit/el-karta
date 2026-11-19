import {
  applyEdit,
  applyModelPatches,
  LiveGraph,
  splitByDocument,
  type Change,
  type DocumentKey,
  type Edit,
  type Model,
} from '@el-karta/core';
import { freeze, type Patch } from 'immer';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

const HISTORY_LIMIT = 200;

interface HistoryEntry {
  patches: Patch[];
  inversePatches: Patch[];
}

export interface ModelState {
  model: Model | null;
  /** Updated in place on every change; subscribe to `graphVersion` to react to it. */
  graph: LiveGraph | null;
  graphVersion: number;
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
    const requireLoaded = () => {
      const { model, graph } = get();
      if (!model || !graph) throw new Error('No project loaded');
      return { model, graph };
    };

    const change = (patches: Patch[], history: Pick<ModelState, 'past' | 'future'>) => {
      const { model, graph } = requireLoaded();
      const next = applyModelPatches(model, patches);
      graph.update(next, patches);
      set((s) => ({
        ...history,
        model: next,
        graphVersion: s.graphVersion + 1,
        pending: enqueue(s.pending, patches),
      }));
    };

    return {
      model: null,
      graph: null,
      graphVersion: 0,
      past: [],
      future: [],
      pending: {},

      load: (model) => {
        // Freezing up front moves Immer's one-time deep freeze out of the first edit.
        freeze(model, true);
        set((s) => ({
          model,
          graph: new LiveGraph(model),
          graphVersion: s.graphVersion + 1,
          past: [],
          future: [],
          pending: {},
        }));
      },

      apply: (edit) => {
        const { model, graph } = requireLoaded();
        const result = applyEdit(model, edit);
        if (result.patches.length === 0) return;
        graph.update(result.model, result.patches);
        set((s) => ({
          model: result.model,
          graphVersion: s.graphVersion + 1,
          past: [
            ...s.past,
            { patches: result.patches, inversePatches: result.inversePatches },
          ].slice(-HISTORY_LIMIT),
          future: [],
          pending: enqueue(s.pending, result.patches),
        }));
      },

      undo: () => {
        const { past, future } = get();
        const entry = past.at(-1);
        if (entry)
          change(entry.inversePatches, { past: past.slice(0, -1), future: [...future, entry] });
      },

      redo: () => {
        const { past, future } = get();
        const entry = future.at(-1);
        if (entry) change(entry.patches, { past: [...past, entry], future: future.slice(0, -1) });
      },
    };
  });
}

export const modelStore = createModelStore();

export const useModelStore = <T>(selector: (state: ModelState) => T): T =>
  useStore(modelStore, selector);
