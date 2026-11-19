import { Maximize, MousePointer2, Redo2, Trash2, Undo2 } from 'lucide-react';
import { modelStore } from '@/model/store';
import { DEFAULT_TOOL, editorStore } from '../editor-store';
import { deleteSelected } from './commands';
import type { EditorExtension, Tool } from './extension';
import { toggleItem } from './selection';

const selectTool: Tool = {
  id: DEFAULT_TOOL,
  label: 'canvas.tools.select',
  icon: MousePointer2,
  order: 0,
  shortcut: 'v',
  onTap: (p, ctx) => {
    if (p.onHandle) return;
    const hit = ctx.itemAt(p.screen, p.kind);
    const { selection, select } = editorStore.getState();
    if (p.shiftKey || p.modKey) {
      if (hit) select(toggleItem(selection, hit));
    } else select(hit ? [hit] : []);
  },
};

/** The select tool and the undo, redo, delete and zoom-to-fit actions. Features render their own items. */
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
};
