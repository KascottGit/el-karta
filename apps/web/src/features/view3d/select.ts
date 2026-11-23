import type { Id } from '@el-karta/core';
import { toggleItem } from '@/features/floorplan/canvas/selection';
import { editorStore, type EditorStore } from '@/features/floorplan/editor-store';
import type { View3dItem } from './dev-hook-types';

/**
 * Applies a tap in the 3D view to the editor's selection, with the 2D select tool's rules: a tap
 * selects the item, Shift or Ctrl/Cmd toggles it, and a tap on nothing clears the selection. An
 * item on another floor opens that floor with the item selected (ADR 0008).
 */
export function selectPicked(
  item: View3dItem | null,
  additive: boolean,
  openFloor: (floorId: Id) => void,
  store: EditorStore = editorStore,
) {
  const editor = store.getState();
  if (!item) {
    if (!additive) editor.select([]);
    return;
  }
  const picked = { collection: item.collection, id: item.id };
  if (item.floorId !== editor.floorId) {
    editor.openFloor(item.floorId, [picked]);
    openFloor(item.floorId);
    return;
  }
  editor.select(additive ? toggleItem(editor.selection, picked) : [picked]);
}
