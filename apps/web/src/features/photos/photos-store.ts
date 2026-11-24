import type { Id } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export type PhotoUpload =
  | { step: 'idle' }
  | { step: 'compressing' }
  | { step: 'uploading' }
  | { step: 'failed'; reason: 'image' | 'upload' };

export interface PhotosState {
  /** The room chosen for photos of a wall that borders several, by wall id. */
  roomChoice: Readonly<Record<Id, Id>>;
  upload: PhotoUpload;
  /** The photo open in the full-size viewer. */
  viewing: Id | null;
}

export const photosStore = createStore<PhotosState>()(() => ({
  roomChoice: {},
  upload: { step: 'idle' },
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
