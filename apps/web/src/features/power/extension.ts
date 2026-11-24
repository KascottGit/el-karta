import type { EditorExtension } from '@/features/floorplan/canvas/extension';
import type { EditorState } from '@/features/floorplan/editor-store';
import type { ModelState } from '@/model/store';
import { PowerPreview } from './power-preview';
import { selectedPower } from './power-edits';
import { PowerPropsPanel, PowerToolPanel } from './power-panels';
import { powerTool } from './power-tool';

const hasPowerSelected = (editor: EditorState, model: ModelState) => {
  const data = editor.floorId ? model.model?.floors[editor.floorId]?.data : undefined;
  return !!data && selectedPower(data, editor.selection).length > 0;
};

/**
 * Outlets, switches and lights (`plugin-power`): placing them and their side panel. The generic
 * devices layer draws them and moves the selected ones along walls and ceilings.
 */
export const powerExtension: EditorExtension = {
  id: 'power',
  tools: [powerTool],
  layers: [{ id: 'power-preview', layer: 'overlays', order: 7, Component: PowerPreview }],
  panels: [
    {
      id: 'power-tool',
      order: 36,
      visible: (editor) => editor.tool === powerTool.id,
      Component: PowerToolPanel,
    },
    { id: 'power-props', order: 37, visible: hasPowerSelected, Component: PowerPropsPanel },
  ],
};
