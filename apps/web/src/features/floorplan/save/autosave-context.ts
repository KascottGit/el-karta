import { createContext, useContext } from 'react';
import type { Autosave } from './autosave';

export const AutosaveContext = createContext<Autosave | null>(null);

/** The autosave of the loaded project, or null where nothing is saved (e.g. the synthetic dev page). */
export const useAutosave = () => useContext(AutosaveContext);
