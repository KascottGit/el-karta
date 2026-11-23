import type { EditorState } from '@/features/floorplan/editor-store';
import type { EditorExtension } from '@/features/floorplan/canvas/extension';
import type { ModelState } from '@/model/store';
import { furnitureMove, furnitureRotate } from './furniture-handles';
import { selectedFurniture } from './furniture-edits';
import { FurnitureHandles, FurniturePreview } from './furniture-overlay';
import { FurniturePropsPanel, FurnitureToolPanel } from './furniture-panels';
import { furnitureTool } from './furniture-tool';

const hasFurnitureSelected = (editor: EditorState, model: ModelState) => {
  const data = editor.floorId ? model.model?.floors[editor.floorId]?.data : undefined;
  return !!data && selectedFurniture(data, editor.selection).length > 0;
};

/**
 * Furniture (`plugin-furnishing`): placing it, moving and turning it, and its side panel. The
 * generic devices layer draws it.
 */
export const furnishingExtension: EditorExtension = {
  id: 'furnishing',
  tools: [furnitureTool],
  handles: [furnitureMove, furnitureRotate],
  layers: [
    { id: 'furniture-preview', layer: 'overlays', order: 6, Component: FurniturePreview },
    { id: 'furniture-handles', layer: 'overlays', order: 25, Component: FurnitureHandles },
  ],
  panels: [
    {
      id: 'furniture-tool',
      order: 38,
      visible: (editor) => editor.tool === furnitureTool.id,
      Component: FurnitureToolPanel,
    },
    {
      id: 'furniture-props',
      order: 39,
      visible: hasFurnitureSelected,
      Component: FurniturePropsPanel,
    },
  ],
};
