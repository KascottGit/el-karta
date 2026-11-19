import type { DocumentKey, Repository } from '@el-karta/core';
import type { StoreApi } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { hasUnsavedChanges, type ModelState } from '@/model/store';
import { describeConflict, type ConflictDescription } from './conflicts';

export interface AutosaveOptions {
  /** Quiet time after the last edit before saving. */
  debounceMs: number;
  /** Longest time an edit waits while the user keeps editing. */
  maxIntervalMs: number;
  /** First retry delay after a failed save; doubles per consecutive failure up to `retryMaxMs`. */
  retryBaseMs: number;
  retryMaxMs: number;
}

export const DEFAULT_AUTOSAVE_OPTIONS: AutosaveOptions = {
  debounceMs: 1500,
  maxIntervalMs: 10_000,
  retryBaseMs: 2000,
  retryMaxMs: 60_000,
};

export interface AutosaveStatus {
  /** Consecutive failed saves; 0 after a successful one. */
  failures: number;
  error: unknown;
  /** When the next automatic retry runs (epoch ms), while failing. */
  retryAt: number | null;
  /** Explanations of the store's `conflicts`, by change id, captured before the merge removed what they touched. */
  conflictDescriptions: Readonly<Record<string, ConflictDescription>>;
}

export interface Autosave {
  status: StoreApi<AutosaveStatus>;
  /** Starts watching the model store for queued changes; returns `stop`, which flushes. Can be restarted. */
  start: () => () => void;
  /** Saves now, after any save in progress; resolves when done (it never rejects; failures go to `status`). */
  flush: () => Promise<void>;
  /** Retries a failed save now instead of waiting for the backoff. */
  retry: () => void;
}

type ModelStore = StoreApi<ModelState>;

/** Resolves once no save is running, so a save started elsewhere is never skipped silently. */
export function whenIdle(store: ModelStore): Promise<void> {
  if (!store.getState().saving) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe((state) => {
      if (state.saving) return;
      unsubscribe();
      resolve();
    });
  });
}

export function createAutosave(
  store: ModelStore,
  repository: Repository,
  options: Partial<AutosaveOptions> = {},
): Autosave {
  const { debounceMs, maxIntervalMs, retryBaseMs, retryMaxMs } = {
    ...DEFAULT_AUTOSAVE_OPTIONS,
    ...options,
  };
  const status = createStore<AutosaveStatus>()(() => ({
    failures: 0,
    error: null,
    retryAt: null,
    conflictDescriptions: {},
  }));

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let active = false;

  const clearTimers = () => {
    clearTimeout(debounceTimer);
    clearTimeout(maxTimer);
    clearTimeout(retryTimer);
    debounceTimer = maxTimer = retryTimer = undefined;
  };

  const schedule = () => {
    if (!active || retryTimer !== undefined) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void save(), debounceMs);
    maxTimer ??= setTimeout(() => void save(), maxIntervalMs);
  };

  function recordConflicts(
    before: ModelState,
    knownIds: ReadonlySet<string>,
    docOf: ReadonlyMap<string, DocumentKey>,
  ) {
    const added = store.getState().conflicts.filter((c) => !knownIds.has(c.change.id));
    if (added.length === 0) return;
    const after = store.getState().model;
    status.setState((s) => ({
      conflictDescriptions: {
        ...s.conflictDescriptions,
        ...Object.fromEntries(
          added.map((c) => [
            c.change.id,
            describeConflict(c, docOf.get(c.change.id), [before.model, after]),
          ]),
        ),
      },
    }));
  }

  async function attempt() {
    while (store.getState().saving) await whenIdle(store);
    const before = store.getState();
    if (!hasUnsavedChanges(before)) {
      status.setState({ failures: 0, error: null, retryAt: null });
      return;
    }
    const docOf = new Map(
      Object.entries(before.pending).flatMap(([doc, changes]) =>
        changes.map((c) => [c.id, doc] as const),
      ),
    );
    const knownIds = new Set(before.conflicts.map((c) => c.change.id));
    try {
      await before.save(repository);
      status.setState({ failures: 0, error: null, retryAt: null });
    } catch (error) {
      const failures = status.getState().failures + 1;
      const delay = Math.min(retryMaxMs, retryBaseMs * 2 ** (failures - 1));
      status.setState({ failures, error, retryAt: Date.now() + delay });
      if (active) {
        clearTimers();
        retryTimer = setTimeout(() => void save(), delay);
      }
    } finally {
      recordConflicts(before, knownIds, docOf);
    }
  }

  function save(): Promise<void> {
    clearTimers();
    running ??= attempt().finally(() => {
      running = null;
      // Edits made while saving wait for their own debounce.
      if (hasUnsavedChanges(store.getState())) schedule();
    });
    return running;
  }

  async function flush() {
    if (running) await running;
    if (hasUnsavedChanges(store.getState())) await save();
  }

  return {
    status,
    flush,
    retry: () => void save(),
    start: () => {
      active = true;
      const unsubscribe = store.subscribe((state, prev) => {
        if (state.pending === prev.pending || running) return;
        if (hasUnsavedChanges(state)) {
          schedule();
        } else {
          // A newly loaded project has nothing queued, so an earlier failure no longer applies.
          clearTimers();
          status.setState({ failures: 0, error: null, retryAt: null });
        }
      });
      if (hasUnsavedChanges(store.getState())) schedule();
      return () => {
        active = false;
        unsubscribe();
        clearTimers();
        void flush();
      };
    },
  };
}
