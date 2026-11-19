import type { Repository } from '@el-karta/core';
import { useEffect, useMemo, type ReactNode } from 'react';
import { modelStore } from '@/model/store';
import { createAutosave } from './autosave';
import { AutosaveContext } from './autosave-context';
import { bindPageLifecycle } from './page-lifecycle';

/**
 * Saves the model store's queued changes to `repository` while mounted, and once more when it unmounts,
 * when the page is hidden, and whenever `flushOn` changes (e.g. switching floors).
 */
export function AutosaveProvider({
  repository,
  flushOn,
  children,
}: {
  repository: Repository;
  flushOn?: unknown;
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

  useEffect(
    () => () => {
      void autosave.flush();
    },
    [autosave, flushOn],
  );

  return <AutosaveContext value={autosave}>{children}</AutosaveContext>;
}
