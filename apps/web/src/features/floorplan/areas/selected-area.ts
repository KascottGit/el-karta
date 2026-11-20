import type { Room, Zone } from '@el-karta/core';
import type { ModelState } from '@/model/store';
import type { EditorState } from '../editor-store';
import type { AreaCollection } from './area-edits';

/** The one selected item, if it is a room or zone on the open floor. */
export function selectedArea(
  editor: EditorState,
  model: ModelState,
  collection: 'rooms',
): Room | null;
export function selectedArea(
  editor: EditorState,
  model: ModelState,
  collection: 'zones',
): Zone | null;
export function selectedArea(editor: EditorState, model: ModelState, collection: AreaCollection) {
  const [item, ...rest] = editor.selection;
  if (!item || rest.length > 0 || item.collection !== collection || !editor.floorId) return null;
  return model.model?.floors[editor.floorId]?.data[collection][item.id] ?? null;
}

export const hasRoomSelected = (editor: EditorState, model: ModelState) =>
  selectedArea(editor, model, 'rooms') !== null;
export const hasZoneSelected = (editor: EditorState, model: ModelState) =>
  selectedArea(editor, model, 'zones') !== null;
