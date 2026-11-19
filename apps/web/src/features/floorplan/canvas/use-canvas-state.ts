import { useCallback, useSyncExternalStore } from 'react';
import { modelStore, type ModelState } from '@/model/store';
import { editorStore, type EditorState } from '../editor-store';

/**
 * Reads a value derived from both the editor and the model store, re-rendering when it changes.
 * The selector must return a primitive or a stable reference.
 */
export function useCanvasState<T>(selector: (editor: EditorState, model: ModelState) => T): T {
  const subscribe = useCallback((onChange: () => void) => {
    const offEditor = editorStore.subscribe(onChange);
    const offModel = modelStore.subscribe(onChange);
    return () => {
      offEditor();
      offModel();
    };
  }, []);
  return useSyncExternalStore(subscribe, () =>
    selector(editorStore.getState(), modelStore.getState()),
  );
}
