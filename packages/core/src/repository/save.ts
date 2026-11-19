import { replayChanges, type Change, type RejectedChange } from '../edits/replay.ts';
import type { SaveResult } from './repository.ts';

export interface SaveOutcome<T> {
  record: T;
  rejected: RejectedChange[];
}

/**
 * Saves queued changes on top of `base` with optimistic locking. On conflict, the changes are
 * replayed on the newer version and saved again; changes that no longer apply are returned for the user to resolve.
 */
export async function saveWithReplay<T extends { version: number }>(
  base: T,
  changes: readonly Change[],
  save: (record: T, expectedVersion: number) => Promise<SaveResult<T>>,
  maxAttempts = 3,
): Promise<SaveOutcome<T>> {
  let current = base;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { doc, rejected } = replayChanges(current, changes);
    const result = await save(doc, current.version);
    if (result.ok) return { record: result.record, rejected };
    current = result.latest;
  }
  throw new Error(`Save kept conflicting after ${maxAttempts} attempts`);
}
