import { useEffect } from 'react';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import { cancel, deleteSelected } from './commands';
import type { CanvasContext, ResolvedExtensions } from './extension';
import { resolveKey, type KeyCommand } from './keymap';

export const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

function run(command: KeyCommand, ctx: CanvasContext, registry: ResolvedExtensions) {
  switch (command.kind) {
    case 'cancel':
      cancel();
      return;
    case 'delete':
      deleteSelected(ctx.floorId);
      return;
    case 'undo':
      modelStore.getState().undo();
      return;
    case 'redo':
      modelStore.getState().redo();
      return;
    case 'tool':
      editorStore.getState().setTool(command.id);
      return;
    case 'action': {
      const action = registry.actions.find((a) => a.id === command.id);
      if (action && (action.enabled?.(editorStore.getState(), modelStore.getState()) ?? true))
        action.run(ctx);
      return;
    }
  }
}

/** Editor shortcuts on the window, except while typing in a field. The active tool sees each key first. */
export function useEditorKeyboard(ctx: CanvasContext, registry: ResolvedExtensions) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditableTarget(e.target)) return;
      if (registry.tool(editorStore.getState().tool).onKeyDown?.(e, ctx)) {
        e.preventDefault();
        return;
      }
      const command = resolveKey(e, registry.shortcuts);
      if (!command) return;
      e.preventDefault();
      run(command, ctx, registry);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [ctx, registry]);
}
