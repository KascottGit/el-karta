import type { Id } from '@el-karta/core';
import { modelStore } from '@/model/store';
import { DEFAULT_TOOL, editorStore } from '../editor-store';
import type { ResolvedExtensions } from './extension';
import { union } from './rect';
import { deleteSelection } from './selection';

/** Escape: stop drawing, else clear the selection, else go back to the default tool. */
export function cancel() {
  const { drawing, selection, tool, setDrawing, select, setTool } = editorStore.getState();
  if (drawing) setDrawing(null);
  else if (selection.length > 0) select([]);
  else if (tool !== DEFAULT_TOOL) setTool(DEFAULT_TOOL);
}

export function deleteSelected(floorId: Id) {
  const floor = modelStore.getState().model?.floors[floorId];
  const { selection, select } = editorStore.getState();
  const edit = floor && deleteSelection(floor, selection);
  if (edit) modelStore.getState().apply(edit);
  select([]);
}

export function zoomToFit(floorId: Id, registry: ResolvedExtensions) {
  const floor = modelStore.getState().model?.floors[floorId];
  const contents = Object.values(registry.layers).flat();
  editorStore.getState().fit(floor ? union(contents.map((c) => c.bounds?.(floor) ?? null)) : null);
}
