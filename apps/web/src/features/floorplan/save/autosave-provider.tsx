import type { Repository } from '@el-karta/core';
import { useEffect, useMemo, type ReactNode } from 'react';
import { modelStore } from '@/model/store';
import { createAutosave } from './autosave';
import { AutosaveContext } from './autosave-context';
import { bindPageLifecycle } from './page-lifecycle';

/**
 * Saves the model store's queued changes to `repository` while mounted, once more when it unmounts,
 * and when the page is hidden. Mount it once, above every page that edits the model.
 */
export function AutosaveProvider({
  repository,
  children,
}: {
  repository: Repository;
  children: ReactNode;
}) {
  const autosave = useMemo(() => createAutosave(modelStore, repository), [repository]);

  useEffect(() => {
    const stop = autosave.start();
    const unbind = bindPageLifecycle(autosave, modelStore);
    return () => {
      unbind();
      stop();
    };
  }, [autosave]);

  return <AutosaveContext value={autosave}>{children}</AutosaveContext>;
}
