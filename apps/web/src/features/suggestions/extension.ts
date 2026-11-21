import type { EditorExtension } from '@/features/floorplan/canvas/extension';
import { union } from '@/features/floorplan/canvas/rect';
import { ghostBounds } from './ghosts';
import { onFloor, suggestionsStore } from './suggestions-store';
import { SuggestionsLayer } from './suggestions-layer';
import { SuggestionsPanel } from './suggestions-panel';
import { SUGGESTIONS_TOOL, suggestionsTool } from './tool';

/** Pending AI suggestions, ghosted on the plan, and the panel to accept or reject them (ADR 0007). */
export const suggestionsExtension: EditorExtension = {
  id: 'suggestions',
  tools: [suggestionsTool],
  layers: [
    {
      id: 'suggestions',
      layer: 'overlays',
      order: -10,
      Component: SuggestionsLayer,
      // Zoom to fit shows the pending suggestions too, such as an imported plan beside the drawn one.
      bounds: (floor) =>
        union(
          Object.values(onFloor(suggestionsStore.getState().ghosts, floor.id) ?? {}).map(
            ghostBounds,
          ),
        ),
    },
  ],
  panels: [
    {
      id: 'suggestions',
      order: 5,
      visible: (editor) => editor.tool === SUGGESTIONS_TOOL,
      Component: SuggestionsPanel,
    },
  ],
};
