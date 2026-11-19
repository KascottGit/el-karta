import type { Id, Model } from '@el-karta/core';
import { useCallback, useEffect, useState } from 'react';
import { useAutosave } from '@/features/floorplan/save/autosave-context';
import { modelStore, UnsavedChangesError, useModelStore } from '@/model/store';
import { useProject } from './queries';

export interface LoadedProject {
  model: Model | null;
  failed: boolean;
  /** Name of another open project whose changes could not be saved, which blocks opening this one. */
  blockedBy: string | null;
  retry: () => void;
  discardOther: () => void;
}

/** Loads a project into the model store once; afterwards the store owns it (edits, saving). */
export function useLoadedProject(projectId: Id): LoadedProject {
  const loaded = useProject(projectId);
  const autosave = useAutosave();
  const model = useModelStore((s) => (s.model?.project.id === projectId ? s.model : null));
  const [blockedBy, setBlockedBy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const data = loaded.data;
    if (!data || modelStore.getState().model?.project.id === projectId) return;
    let cancelled = false;
    // Save whatever the previously open project still has queued before replacing it.
    void (autosave?.flush() ?? Promise.resolve()).then(() => {
      if (cancelled) return;
      try {
        modelStore.getState().load(data);
        setBlockedBy(null);
      } catch (error) {
        if (!(error instanceof UnsavedChangesError)) throw error;
        setBlockedBy(error.projectName);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loaded.data, projectId, autosave, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);
  const discardOther = useCallback(() => {
    if (!loaded.data) return;
    modelStore.getState().load(loaded.data, { discardUnsaved: true });
    setBlockedBy(null);
  }, [loaded.data]);

  return { model, failed: loaded.isError, blockedBy, retry, discardOther };
}
