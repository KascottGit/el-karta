import type { EditorExtension } from '../canvas/extension';
import { contentBounds, gridFitBounds } from './extent';
import { GridLayer, GridLineDraft } from './grid-layer';
import { GridPanel, SelectionCellPanel } from './grid-panel';
import { GRID_TOOL, gridLineHandle, gridTool } from './interaction';

/** Grid lines (axes A, B, C … and 1, 2, 3 …) and the grid location of the pointer and the selection. */
export const gridExtension: EditorExtension = {
  id: 'grid',
  tools: [gridTool],
  handles: [gridLineHandle],
  layers: [
    {
      id: 'grid',
      layer: 'grid',
      order: 0,
      Component: GridLayer,
      bounds: ({ data }) => (data.grid ? gridFitBounds(data.grid, contentBounds(data)) : null),
    },
    { id: 'grid-line-draft', layer: 'overlays', order: 0, Component: GridLineDraft },
  ],
  panels: [
    { id: 'grid', order: 50, visible: (editor) => editor.tool === GRID_TOOL, Component: GridPanel },
    {
      id: 'grid-cell',
      order: 1000,
      visible: (editor, { model }) =>
        editor.selection.length > 0 &&
        editor.floorId !== null &&
        model?.floors[editor.floorId]?.data.grid !== undefined,
      Component: SelectionCellPanel,
    },
  ],
};
