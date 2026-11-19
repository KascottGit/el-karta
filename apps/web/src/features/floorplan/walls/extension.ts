import type { ModelState } from '@/model/store';
import type { EditorState } from '../editor-store';
import type { EditorExtension } from '../canvas/extension';
import { union } from '../canvas/rect';
import { cornerHandle } from './corner-handle';
import { WallPropsPanel, WallToolPanel } from './wall-panels';
import { wallBounds } from './wall-outline';
import { WALL_TOOL, wallTool } from './wall-tool';
import { WallsLayer } from './walls-layer';
import { WallsOverlay } from './walls-overlay';

const wallToolActive = (editor: EditorState) => editor.tool === WALL_TOOL;

const hasWallSelected = (editor: EditorState, model: ModelState) => {
  const walls = editor.floorId ? model.model?.floors[editor.floorId]?.data.walls : undefined;
  return !!walls && editor.selection.some((s) => s.collection === 'walls' && s.id in walls);
};

/** Walls: the wall tool, corner handles, the walls layer and the wall side panels. */
export const wallsExtension: EditorExtension = {
  id: 'walls',
  tools: [wallTool],
  handles: [cornerHandle],
  layers: [
    {
      id: 'walls',
      layer: 'walls',
      order: 0,
      Component: WallsLayer,
      bounds: ({ data }) => union(Object.values(data.walls).map(wallBounds)),
    },
    { id: 'walls-overlay', layer: 'overlays', order: 0, Component: WallsOverlay },
  ],
  panels: [
    { id: 'wall-tool', order: 10, visible: wallToolActive, Component: WallToolPanel },
    { id: 'wall-props', order: 11, visible: hasWallSelected, Component: WallPropsPanel },
  ],
};
