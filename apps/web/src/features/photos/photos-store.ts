import type { Id } from '@el-karta/core';
import type { AnalysisErrorCode, AnalysisStep } from './analysis';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export type PhotoUpload =
  | { step: 'idle' }
  | { step: 'compressing' }
  | { step: 'uploading' }
  | { step: 'failed'; reason: 'image' | 'upload' };

/** The latest photo analysis (M11 T4); analyses run one at a time. */
export type PhotoAnalysis =
  | { step: 'idle' }
  | { step: AnalysisStep; photoId: Id }
  /** `count` suggestions were stored. */
  | { step: 'done'; photoId: Id; count: number }
  | { step: 'failed'; photoId: Id; error: AnalysisErrorCode };

export interface PhotosState {
  /** The room chosen for photos of a wall that borders several, by wall id. */
  roomChoice: Readonly<Record<Id, Id>>;
  upload: PhotoUpload;
  analysis: PhotoAnalysis;
  /** The photo open in the full-size viewer. */
  viewing: Id | null;
}

export const photosStore = createStore<PhotosState>()(() => ({
  roomChoice: {},
  upload: { step: 'idle' },
  analysis: { step: 'idle' },
  viewing: null,
}));

export const usePhotosStore = <T>(selector: (state: PhotosState) => T): T =>
  useStore(photosStore, selector);

export const chooseRoom = (wallId: Id, roomId: Id) => {
  photosStore.setState((s) => ({ roomChoice: { ...s.roomChoice, [wallId]: roomId } }));
};

export const setUpload = (upload: PhotoUpload) => {
  photosStore.setState({ upload });
};

export const viewPhoto = (viewing: Id | null) => {
  photosStore.setState({ viewing });
};

export const setAnalysis = (analysis: PhotoAnalysis) => {
  photosStore.setState({ analysis });
};
