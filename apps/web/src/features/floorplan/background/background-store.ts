import type { BackgroundPlacement, Id } from '@el-karta/core';
import { createStore } from 'zustand/vanilla';
import type { PdfFile } from './pdf';

export type UploadStep =
  | { step: 'idle' }
  | { step: 'reading' }
  | { step: 'pick-page'; pdf: PdfFile }
  | { step: 'rendering'; page: number }
  | { step: 'uploading' }
  | { step: 'failed'; reason: 'unsupported' | 'pdf' | 'upload' };

/** UI state of the background feature. Never saved: opacity is a viewing preference. */
export interface BackgroundUiState {
  opacity: number;
  /** The placement while a handle is dragged; it becomes an edit when the drag ends. */
  draft: { floorId: Id; placement: BackgroundPlacement } | null;
  upload: UploadStep;
}

export const DEFAULT_OPACITY = 0.6;

export const backgroundUi = createStore<BackgroundUiState>()(() => ({
  opacity: DEFAULT_OPACITY,
  draft: null,
  upload: { step: 'idle' },
}));

export const setUploadStep = (upload: UploadStep) => {
  backgroundUi.setState({ upload });
};
