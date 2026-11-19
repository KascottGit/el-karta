import {
  combine,
  removeConnection,
  removeDevice,
  removeSpaceItem,
  type Edit,
  type FloorCollection,
  type FloorRecord,
  type Id,
} from '@el-karta/core';

export const FLOOR_COLLECTIONS: readonly FloorCollection[] = [
  'walls',
  'openings',
  'rooms',
  'zones',
  'devices',
  'connections',
];

export interface SelectionItem {
  collection: FloorCollection;
  id: Id;
}

export const sameItem = (a: SelectionItem, b: SelectionItem): boolean =>
  a.collection === b.collection && a.id === b.id;

export const isSelected = (selection: readonly SelectionItem[], item: SelectionItem): boolean =>
  selection.some((s) => sameItem(s, item));

export const toggleItem = (
  selection: readonly SelectionItem[],
  item: SelectionItem,
): SelectionItem[] =>
  isSelected(selection, item) ? selection.filter((s) => !sameItem(s, item)) : [...selection, item];

/** Ids of the selected items in one collection, for renderers to highlight. */
export const selectedIds = (
  selection: readonly SelectionItem[],
  collection: FloorCollection,
): ReadonlySet<Id> =>
  new Set(selection.filter((s) => s.collection === collection).map((s) => s.id));

// Dependents go first: removing a wall already removes its openings, and a device its connections.
const DELETE_ORDER: readonly FloorCollection[] = [
  'connections',
  'openings',
  'devices',
  'rooms',
  'zones',
  'walls',
];

/** One undoable edit that removes every selected item still on the floor, or null if there is none. */
export function deleteSelection(
  floor: FloorRecord,
  selection: readonly SelectionItem[],
): Edit | null {
  const edits: Edit[] = [];
  for (const collection of DELETE_ORDER) {
    const ids = new Set(
      selection
        .filter((s) => s.collection === collection && s.id in floor.data[collection])
        .map((s) => s.id),
    );
    for (const id of ids) {
      if (collection === 'devices') edits.push(removeDevice(id));
      else if (collection === 'connections') edits.push(removeConnection(id));
      else edits.push(removeSpaceItem(floor.id, collection, id));
    }
  }
  return edits.length > 0 ? combine(...edits) : null;
}
