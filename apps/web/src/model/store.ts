import {
  applyEdit,
  applyModelPatches,
  LiveGraph,
  replayChanges,
  saveWithReplay,
  splitByDocument,
  type Change,
  type DocumentKey,
  type Edit,
  type FloorRecord,
  type Model,
  type ProjectRecord,
  type RejectedChange,
  type Repository,
  type SaveOutcome,
} from '@el-karta/core';
import { freeze, type Patch } from 'immer';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

const HISTORY_LIMIT = 200;

type StoredDocument = ProjectRecord | FloorRecord;

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
  /** The last version of each document known to be stored; queued changes are replayed onto it. */
  saved: Readonly<Record<DocumentKey, StoredDocument>>;
  saving: boolean;
  /** Changes that could not be applied on top of someone else's newer version, for the user to resolve. */
  conflicts: RejectedChange[];
  load: (model: Model) => void;
  apply: (edit: Edit) => void;
  undo: () => void;
  redo: () => void;
  /** Saves every document with queued changes. Safe to call repeatedly; overlapping calls are skipped. */
  save: (repository: Repository) => Promise<void>;
}

const documentPath = (doc: DocumentKey) => (doc === 'project' ? ['project'] : ['floors', doc]);

const documentOf = (model: Model, doc: DocumentKey): StoredDocument | undefined =>
  doc === 'project' ? model.project : model.floors[doc];

const savedDocuments = (model: Model): Record<DocumentKey, StoredDocument> => ({
  project: model.project,
  ...model.floors,
});

function saveDocument(
  repository: Repository,
  doc: DocumentKey,
  base: StoredDocument,
  changes: readonly Change[],
): Promise<SaveOutcome<StoredDocument>> {
  return doc === 'project'
    ? saveWithReplay(base as ProjectRecord, changes, (r, v) => repository.saveProject(r, v))
    : saveWithReplay(base as FloorRecord, changes, (r, v) => repository.saveFloor(r, v));
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

    /** Brings the local document in line with what was stored, keeping changes made while saving. */
    function settle(
      doc: DocumentKey,
      base: StoredDocument,
      sent: readonly Change[],
      outcome: SaveOutcome<StoredDocument>,
    ) {
      const { model, graph } = requireLoaded();
      const sentIds = new Set(sent.map((c) => c.id));
      const remaining = (get().pending[doc] ?? []).filter((c) => !sentIds.has(c.id));
      const local = documentOf(model, doc);
      const untouchedByOthers =
        outcome.record.version === base.version + 1 && outcome.rejected.length === 0;
      const patches: Patch[] =
        untouchedByOthers && local
          ? [
              {
                op: 'replace',
                path: [...documentPath(doc), 'version'],
                value: outcome.record.version,
              },
            ]
          : [
              {
                op: 'replace',
                path: documentPath(doc),
                value: replayChanges(outcome.record, remaining).doc,
              },
            ];
      const next = applyModelPatches(model, patches);
      graph.update(next, patches);
      set((s) => ({
        model: next,
        graphVersion: s.graphVersion + 1,
        pending: { ...s.pending, [doc]: remaining },
        saved: { ...s.saved, [doc]: outcome.record },
        conflicts: [...s.conflicts, ...outcome.rejected],
      }));
    }

    return {
      model: null,
      graph: null,
      graphVersion: 0,
      past: [],
      future: [],
      pending: {},
      saved: {},
      saving: false,
      conflicts: [],

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
          saved: savedDocuments(model),
          conflicts: [],
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

      save: async (repository) => {
        const { saving, pending, saved } = get();
        if (saving) return;
        const batches = Object.entries(pending).filter(([, changes]) => changes.length > 0);
        if (batches.length === 0) return;
        set({ saving: true });
        try {
          await Promise.all(
            batches.map(async ([doc, changes]) => {
              const base = saved[doc];
              if (!base) throw new Error(`No saved version of document ${doc}`);
              const outcome = await saveDocument(repository, doc, base, changes);
              settle(doc, base, changes, outcome);
            }),
          );
        } finally {
          set({ saving: false });
        }
      },
    };
  });
}

export const modelStore = createModelStore();

export const useModelStore = <T>(selector: (state: ModelState) => T): T =>
  useStore(modelStore, selector);
