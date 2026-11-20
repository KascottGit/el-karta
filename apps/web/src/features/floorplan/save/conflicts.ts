import type { DocumentKey, Model, RejectedChange } from '@el-karta/core';
import type { StoreApi } from 'zustand';
import type { ModelState } from '@/model/store';

const ITEM_KINDS = {
  walls: 'wall',
  openings: 'opening',
  rooms: 'room',
  zones: 'zone',
  devices: 'device',
  connections: 'connection',
  buildings: 'building',
  crossFloorConnections: 'connection',
} as const;

type ItemCollection = keyof typeof ITEM_KINDS;
type ItemKind = (typeof ITEM_KINDS)[ItemCollection];
type OpeningKind = 'door' | 'window' | 'passage';

/** What a rejected change touched, named as the user knew it before someone else's version replaced it. */
export type ConflictSubject =
  | { kind: Exclude<ItemKind, 'opening'>; id: string; name?: string }
  | { kind: 'opening'; id: string; openingKind?: OpeningKind }
  | { kind: 'floor' | 'grid' | 'background' | 'scale' | 'project' };

export interface ConflictDescription {
  changeId: string;
  /** `remove` when the change only removed things, otherwise `change`. */
  action: 'change' | 'remove';
  subjects: ConflictSubject[];
  /** The floor the change was made on, when it was a floor document and that floor is known. */
  floorName?: string;
}

const isItemCollection = (key: unknown): key is ItemCollection =>
  typeof key === 'string' && Object.hasOwn(ITEM_KINDS, key);

const FLOOR_SETTINGS = new Set(['grid', 'background', 'scale']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The item at `data.<collection>.<id>` in a stored document, if the model has that document. */
function storedItem(
  model: Model | null | undefined,
  doc: DocumentKey | undefined,
  collection: ItemCollection,
  id: string,
): unknown {
  if (!model) return undefined;
  const lookIn = (data: object) =>
    (data as Record<string, Record<string, unknown> | undefined>)[collection]?.[id];
  if (doc === 'project') return lookIn(model.project.data);
  if (doc !== undefined) {
    const floor = model.floors[doc];
    return floor && lookIn(floor.data);
  }
  for (const floor of Object.values(model.floors)) {
    const item = lookIn(floor.data);
    if (item !== undefined) return item;
  }
  return lookIn(model.project.data);
}

function subjectOf(
  path: readonly (string | number)[],
  doc: DocumentKey | undefined,
  value: unknown,
  models: readonly (Model | null | undefined)[],
): ConflictSubject {
  const [root, collection, id] = path;
  if (root === 'data' && isItemCollection(collection) && id !== undefined) {
    const itemId = String(id);
    const kind = ITEM_KINDS[collection];
    const known = [
      ...models.map((model) => storedItem(model, doc, collection, itemId)),
      path.length === 3 ? value : undefined,
    ].find(isRecord);
    if (kind === 'opening') {
      const openingKind = known?.['kind'];
      return typeof openingKind === 'string'
        ? { kind, id: itemId, openingKind: openingKind as OpeningKind }
        : { kind, id: itemId };
    }
    const name = known?.[kind === 'device' ? 'label' : 'name'];
    return typeof name === 'string' && name !== ''
      ? { kind, id: itemId, name }
      : { kind, id: itemId };
  }
  if (root === 'data' && typeof collection === 'string' && FLOOR_SETTINGS.has(collection)) {
    return { kind: collection as 'grid' | 'background' | 'scale' };
  }
  return { kind: doc === 'project' ? 'project' : 'floor' };
}

const sameSubject = (a: ConflictSubject, b: ConflictSubject) =>
  a.kind === b.kind && ('id' in a ? 'id' in b && a.id === b.id : true);

/**
 * Explains a change that could not be replayed onto someone else's newer version.
 * `doc` is the document the change was queued for, when known; names are looked up in `models` in order,
 * then in the change's own patch values, because the item itself is usually gone from the merged model.
 */
export function describeConflict(
  rejected: RejectedChange,
  doc: DocumentKey | undefined,
  models: readonly (Model | null | undefined)[],
): ConflictDescription {
  const { change } = rejected;
  const subjects: ConflictSubject[] = [];
  for (const patch of change.patches) {
    const subject = subjectOf(patch.path, doc, patch.value, models);
    if (!subjects.some((s) => sameSubject(s, subject))) subjects.push(subject);
  }
  const removesOnly =
    change.patches.length > 0 &&
    change.patches.every((p) => p.op === 'remove' && p.path.length === 3);
  const floorName =
    doc === undefined || doc === 'project'
      ? undefined
      : models.map((model) => model?.floors[doc]?.name).find((name) => name !== undefined);
  return {
    changeId: change.id,
    action: removesOnly ? 'remove' : 'change',
    subjects,
    ...(floorName === undefined ? {} : { floorName }),
  };
}

/** Removes conflicts the user has read; with no ids, removes them all. */
export function dismissConflicts(store: StoreApi<ModelState>, changeIds?: readonly string[]) {
  const ids = changeIds && new Set(changeIds);
  store.setState((s) => ({
    conflicts: ids ? s.conflicts.filter((c) => !ids.has(c.change.id)) : [],
  }));
}
