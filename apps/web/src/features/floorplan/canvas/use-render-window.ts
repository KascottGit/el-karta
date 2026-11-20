import { useDeferredValue } from 'react';
import { useEditorStore } from '../editor-store';
import type { RenderWindow } from './viewport';

/**
 * The render window to cull by. It is deferred, so when panning crosses into a new window the
 * newly visible shapes mount in an interruptible background render rather than in one long frame;
 * the window's margin keeps the view covered meanwhile.
 */
export function useRenderWindow(): RenderWindow {
  return useDeferredValue(useEditorStore((s) => s.renderWindow));
}
