import type { Id, Model } from '@el-karta/core';
import { useEffect } from 'react';
import { modelStore, useModelStore } from '@/model/store';
import { useProject } from './queries';

/** Loads a project into the model store once; afterwards the store owns it (edits, saving). */
export function useLoadedProject(projectId: Id): { model: Model | null; failed: boolean } {
  const loaded = useProject(projectId);
  const model = useModelStore((s) => (s.model?.project.id === projectId ? s.model : null));

  useEffect(() => {
    if (loaded.data && modelStore.getState().model?.project.id !== projectId) {
      modelStore.getState().load(loaded.data);
    }
  }, [loaded.data, projectId]);

  return { model, failed: loaded.isError };
}
