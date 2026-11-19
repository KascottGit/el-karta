import { Maximize, MousePointer2, Redo2, Trash2, Undo2 } from 'lucide-react';
import { modelStore } from '@/model/store';
import { DEFAULT_TOOL, editorStore } from '../editor-store';
import { deleteSelected } from './commands';
import type { EditorExtension, Tool } from './extension';
import { boundsOf, union } from './rect';
import { AreasLayer } from './render/areas-layer';
import { WallsLayer } from './render/walls-layer';
import { toggleItem } from './selection';
import { wallBounds } from './wall-outline';

const selectTool: Tool = {
  id: DEFAULT_TOOL,
  label: 'canvas.tools.select',
  icon: MousePointer2,
  order: 0,
  shortcut: 'v',
  onTap: (p, ctx) => {
    const hit = ctx.itemAt(p.screen);
    const { selection, select } = editorStore.getState();
    if (p.shiftKey || p.modKey) {
      if (hit) select(toggleItem(selection, hit));
    } else select(hit ? [hit] : []);
  },
};

/** The select tool, undo/redo/delete/fit actions and the read-only renderers of walls, rooms and zones. */
export const baseExtension: EditorExtension = {
  id: 'base',
  tools: [selectTool],
  actions: [
    {
      id: 'undo',
      label: 'canvas.undo',
      icon: Undo2,
      order: 0,
      enabled: (_, model) => model.past.length > 0,
      run: () => {
        modelStore.getState().undo();
      },
    },
    {
      id: 'redo',
      label: 'canvas.redo',
      icon: Redo2,
      order: 1,
      enabled: (_, model) => model.future.length > 0,
      run: () => {
        modelStore.getState().redo();
      },
    },
    {
      id: 'delete',
      label: 'canvas.delete',
      icon: Trash2,
      order: 10,
      enabled: (editor) => editor.selection.length > 0,
      run: (ctx) => {
        deleteSelected(ctx.floorId);
      },
    },
    {
      id: 'zoom-to-fit',
      label: 'canvas.zoomToFit',
      icon: Maximize,
      order: 20,
      shortcut: 'f',
      run: (ctx) => {
        ctx.zoomToFit();
      },
    },
  ],
  layers: [
    {
      id: 'areas',
      layer: 'areas',
      order: 0,
      Component: AreasLayer,
      bounds: ({ data }) =>
        union(
          [...Object.values(data.rooms), ...Object.values(data.zones)].map((a) =>
            boundsOf(a.polygon),
          ),
        ),
    },
    {
      id: 'walls',
      layer: 'walls',
      order: 0,
      Component: WallsLayer,
      bounds: ({ data }) => union(Object.values(data.walls).map(wallBounds)),
    },
  ],
};
