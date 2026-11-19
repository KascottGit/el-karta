import { createContext, useContext, useEffect } from 'react';
import type { Autosave } from './autosave';

export const AutosaveContext = createContext<Autosave | null>(null);

/** The app's autosave, or null on pages outside it, where nothing is saved (e.g. the synthetic dev page). */
export const useAutosave = () => useContext(AutosaveContext);

/** Saves at once when `value` changes or the caller unmounts, e.g. when switching or leaving a floor. */
export function useFlushOn(value: unknown) {
  const autosave = useAutosave();
  useEffect(
    () => () => {
      void autosave?.flush();
    },
    [autosave, value],
  );
}
