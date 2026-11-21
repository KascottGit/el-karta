import type { ReadProgress } from '@el-karta/ai-passes';
import type { Id } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { editorStore } from '../editor-store';
import type { ImportErrorCode } from './errors';
import type { PlanReading } from './reading';

/** Where an import of one floor's plan stands. Only one import runs at a time. */
export type ImportStep =
  | { step: 'idle' }
  | { step: 'reading'; floorId: Id; progress: ReadProgress | null }
  /** Nothing printed gave a scale: "Vet du ett mått?" */
  | { step: 'ask-scale'; floorId: Id; reading: PlanReading }
  /** Waiting for the person to set the scale with the scale tool. */
  | { step: 'measuring'; floorId: Id; reading: PlanReading }
  | { step: 'saving'; floorId: Id }
  /** Re-interpreting a stored reading after the scale changed. */
  | { step: 'updating'; floorId: Id }
  /** `retry` says what "Försök igen" does: read the plan again, or only re-interpret it. */
  | { step: 'failed'; floorId: Id; error: ImportErrorCode; retry: 'read' | 'update' };

export const importStore = createStore<{ current: ImportStep }>()(() => ({
  current: { step: 'idle' },
}));

export const useImport = () => useStore(importStore, (s) => s.current);

export function setImportStep(current: ImportStep) {
  importStore.setState({ current });
  // Panels' and actions' `visible` and `enabled` read only the editor and model stores; this makes
  // the toolbar and side panel check them again.
  editorStore.setState({});
}

/** The import step if it belongs to `floorId`. */
export const importOn = (floorId: Id | null): ImportStep => {
  const { current } = importStore.getState();
  return current.step !== 'idle' && current.floorId === floorId ? current : { step: 'idle' };
};

/** Steps during which another import cannot start. */
export const isBusy = (step: ImportStep) => step.step !== 'idle' && step.step !== 'failed';
