import { applyPatches, produce, type Draft, type Patch } from 'immer';

/** One user edit's patches for one document; replayed all-or-nothing. */
export interface Change {
  id: string;
  patches: readonly Patch[];
}

export interface RejectedChange {
  change: Change;
  reason: string;
}

export interface ReplayResult<T> {
  doc: T;
  applied: Change[];
  rejected: RejectedChange[];
}

class PatchConflict extends Error {}

const isObject = (value: unknown): value is Record<string | number, unknown> =>
  typeof value === 'object' && value !== null;

/** Immer applies some stale patches silently (e.g. `remove` of a missing key), so check the target first. */
function assertApplies(root: unknown, patch: Patch) {
  const { path, op } = patch;
  if (path.length === 0) return;
  let node = root;
  for (const key of path.slice(0, -1)) {
    if (!isObject(node) || !(key in node)) throw new PatchConflict(`missing ${path.join('/')}`);
    node = node[key];
  }
  const last = path[path.length - 1]!;
  if (!isObject(node)) throw new PatchConflict(`missing ${path.join('/')}`);
  if ((op === 'replace' || op === 'remove') && !(last in node))
    throw new PatchConflict(`missing ${path.join('/')}`);
  if (op === 'add' && Array.isArray(node) && Number(last) > node.length)
    throw new PatchConflict(`index out of range ${path.join('/')}`);
}

/**
 * Re-applies queued changes on top of a newer version of a document.
 * A change whose target no longer exists is rejected whole and reported, never dropped silently.
 */
export function replayChanges<T extends object>(
  doc: T,
  changes: readonly Change[],
): ReplayResult<T> {
  const applied: Change[] = [];
  const rejected: RejectedChange[] = [];
  let current = doc;
  for (const change of changes) {
    try {
      current = produce(current, (draft: Draft<T>) => {
        for (const patch of change.patches) {
          assertApplies(draft, patch);
          // Applied one by one so each patch is checked against the result of the previous one.
          void applyPatches(draft, [patch]);
        }
      });
      applied.push(change);
    } catch (error) {
      if (!(error instanceof PatchConflict)) throw error;
      rejected.push({ change, reason: error.message });
    }
  }
  return { doc: current, applied, rejected };
}
