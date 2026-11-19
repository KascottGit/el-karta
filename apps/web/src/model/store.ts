import {
  addFloor,
  applyEdit,
  applyModelPatches,
  LiveGraph,
  removeFloor,
  replayChanges,
  saveWithReplay,
  splitByDocument,
  type Change,
  type DocumentKey,
  type Edit,
  type FloorRecord,
  type Id,
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
  /** Stores a new floor row through the repository, then adds it to the model. */
  createFloor: (repository: Repository, floor: FloorRecord) => Promise<FloorRecord>;
  /**
   * Deletes a floor row through the repository, then removes the floor, its queued changes and the
   * cross-floor connections to it, and saves the project document. Clears undo history, which may refer to the floor.
   */
  deleteFloor: (repository: Repository, floorId: Id) => Promise<void>;
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

const without = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

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

    let running: Promise<unknown> = Promise.resolve();

    /** Runs one repository write at a time, waiting for the one in flight; `saving` is true meanwhile. */
    async function exclusive<T>(work: () => Promise<T>): Promise<T> {
      while (get().saving) await running.catch(() => undefined);
      set({ saving: true });
      const run = work();
      running = run;
      try {
        return await run;
      } finally {
        set({ saving: false });
      }
    }

    async function saveBatches(
      repository: Repository,
      batches: readonly (readonly [DocumentKey, Change[]])[],
    ) {
      const { saved } = get();
      // Settle every document before returning, so `saving` stays true until none is in flight.
      const results = await Promise.allSettled(
        batches.map(async ([doc, changes]) => {
          const base = saved[doc];
          if (!base) throw new Error(`No saved version of document ${doc}`);
          const outcome = await saveDocument(repository, doc, base, changes);
          settle(doc, base, changes, outcome);
        }),
      );
      const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1)
        throw new AggregateError(errors, 'Saving failed for several documents');
    }

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

    /**
     * Brings the local document in line with what was stored, keeping changes made while saving.
     * A late result for a floor deleted meanwhile is ignored, so it cannot bring the floor back.
     */
    function settle(
      doc: DocumentKey,
      base: StoredDocument,
      sent: readonly Change[],
      outcome: SaveOutcome<StoredDocument>,
    ) {
      if (doc !== 'project' && !(doc in get().saved)) return;
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
        const { saving, pending } = get();
        if (saving) return;
        const batches = Object.entries(pending).filter(([, changes]) => changes.length > 0);
        if (batches.length === 0) return;
        await exclusive(() => saveBatches(repository, batches));
      },

      createFloor: async (repository, floor) => {
        applyEdit(requireLoaded().model, addFloor(floor));
        const stored = await repository.createFloor(floor);
        const { model, graph } = requireLoaded();
        const result = applyEdit(model, addFloor(stored));
        graph.update(result.model, result.patches);
        set((s) => ({
          model: result.model,
          graphVersion: s.graphVersion + 1,
          saved: { ...s.saved, [stored.id]: stored },
        }));
        return stored;
      },

      deleteFloor: (repository, floorId) =>
        exclusive(async () => {
          const { model: before } = requireLoaded();
          applyEdit(before, removeFloor(floorId));
          await repository.deleteFloor(before.project.id, floorId);
          const { model, graph } = requireLoaded();
          const result = applyEdit(model, removeFloor(floorId));
          graph.update(result.model, result.patches);
          const projectPatches = result.patches.filter((patch) => patch.path[0] === 'project');
          set((s) => ({
            model: result.model,
            graphVersion: s.graphVersion + 1,
            past: [],
            future: [],
            pending: enqueue(without(s.pending, floorId), projectPatches),
            saved: without(s.saved, floorId),
          }));
          const changes = get().pending.project ?? [];
          // The floor is already gone; if this save fails the changes stay queued for the next save.
          if (changes.length > 0)
            await saveBatches(repository, [['project', changes]]).catch(() => undefined);
        }),
    };
  });
}

export const modelStore = createModelStore();

export const useModelStore = <T>(selector: (state: ModelState) => T): T =>
  useStore(modelStore, selector);
