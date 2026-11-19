import { enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import type { DocumentKey } from '../model.ts';
import type { Model } from '../schemas/index.ts';

enablePatches();

/** A recipe that mutates a draft; `base` is the unproxied model, for fast lookups. */
export type Edit = (draft: Draft<Model>, base: Model) => void;

export interface EditResult {
  model: Model;
  patches: Patch[];
  inversePatches: Patch[];
}

export class EditError extends Error {
  override name = 'EditError';
}

export function applyEdit(model: Model, edit: Edit): EditResult {
  const [next, patches, inversePatches] = produceWithPatches(model, (draft) => {
    edit(draft, model);
  });
  return { model: next, patches, inversePatches };
}

/**
 * Splits model-level patches into patches per stored document (project row or floor row),
 * with paths relative to that record, so each document can be saved and replayed on its own.
 */
export function splitByDocument(patches: readonly Patch[]): Map<DocumentKey, Patch[]> {
  const result = new Map<DocumentKey, Patch[]>();
  const add = (key: DocumentKey, patch: Patch) => {
    const list = result.get(key);
    if (list) list.push(patch);
    else result.set(key, [patch]);
  };
  for (const patch of patches) {
    const [root, id, ...rest] = patch.path;
    if (root === 'project') add('project', { ...patch, path: patch.path.slice(1) });
    else if (root === 'floors' && typeof id === 'string') add(id, { ...patch, path: rest });
    else throw new EditError(`Patch path cannot be mapped to a document: ${patch.path.join('/')}`);
  }
  return result;
}
