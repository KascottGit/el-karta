import type { StoreApi } from 'zustand';
import type { ModelState } from '@/model/store';
import { hasUnsavedChanges, type Autosave } from './autosave';

type VisibilityTarget = EventTarget & { readonly visibilityState: DocumentVisibilityState };

/**
 * Saves when the page is hidden or closed, and asks the browser to confirm leaving while changes are
 * still unsaved, because a request started during unload is not guaranteed to complete.
 */
export function bindPageLifecycle(
  autosave: Pick<Autosave, 'flush'>,
  store: StoreApi<ModelState>,
  win: EventTarget = window,
  doc: VisibilityTarget = document,
): () => void {
  const flush = () => void autosave.flush();
  const onVisibilityChange = () => {
    if (doc.visibilityState === 'hidden') flush();
  };
  const onBeforeUnload = (event: Event) => {
    const state = store.getState();
    if (!hasUnsavedChanges(state) && !state.saving) return;
    flush();
    event.preventDefault();
  };
  win.addEventListener('pagehide', flush);
  win.addEventListener('beforeunload', onBeforeUnload);
  doc.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    win.removeEventListener('pagehide', flush);
    win.removeEventListener('beforeunload', onBeforeUnload);
    doc.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
