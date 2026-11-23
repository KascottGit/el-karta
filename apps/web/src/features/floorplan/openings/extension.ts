import type { ModelState } from '@/model/store';
import type { EditorState } from '../editor-store';
import type { EditorExtension } from '../canvas/extension';
import { openingEdgeHandle, openingSlide } from './opening-handle';
import { OpeningPropsPanel, OpeningToolPanel } from './opening-panels';
import { isOpeningTool, OPENING_TOOLS } from './opening-tools';
import { OpeningsLayer } from './openings-layer';
import { OpeningsOverlay } from './openings-overlay';

const hasOpeningSelected = (editor: EditorState, model: ModelState) => {
  const openings = editor.floorId ? model.model?.floors[editor.floorId]?.data.openings : undefined;
  return (
    !!openings && editor.selection.some((s) => s.collection === 'openings' && s.id in openings)
  );
};

/** Doors, windows and passages: a tool for each, sliding and widening them along their wall, and their side panels. */
export const openingsExtension: EditorExtension = {
  id: 'openings',
  tools: OPENING_TOOLS,
  handles: [openingSlide, openingEdgeHandle],
  layers: [
    { id: 'openings', layer: 'openings', order: 0, Component: OpeningsLayer },
    { id: 'openings-overlay', layer: 'overlays', order: 1, Component: OpeningsOverlay },
  ],
  panels: [
    {
      id: 'opening-tool',
      order: 30,
      visible: (editor) => isOpeningTool(editor.tool),
      Component: OpeningToolPanel,
    },
    { id: 'opening-props', order: 31, visible: hasOpeningSelected, Component: OpeningPropsPanel },
  ],
};
