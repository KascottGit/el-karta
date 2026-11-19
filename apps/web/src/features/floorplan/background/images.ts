import type { Id } from '@el-karta/core';
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { attachmentUrl } from './attachments';
import type { ImageSize } from './plan-file';
import { createSignedUrlCache } from './signed-urls';

export type BackgroundImage =
  | { status: 'loading' }
  | { status: 'ready'; image: HTMLImageElement; size: ImageSize }
  | { status: 'failed' };

/**
 * Background images by attachment id. Kept as image elements, so the browser can drop decoded
 * pixels of floors that are not shown; reloading one uses the cached signed URL.
 */
export const imageStore = createStore<Readonly<Record<Id, BackgroundImage>>>()(() => ({}));

const urls = createSignedUrlCache(attachmentUrl);

const setImage = (attachmentId: Id, image: BackgroundImage) => {
  imageStore.setState((s) => ({ ...s, [attachmentId]: image }));
};

async function decode(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = src;
  await image.decode();
  return image;
}

const ready = (image: HTMLImageElement): BackgroundImage => ({
  status: 'ready',
  image,
  size: { width: image.naturalWidth, height: image.naturalHeight },
});

async function load(attachmentId: Id) {
  setImage(attachmentId, { status: 'loading' });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      setImage(attachmentId, ready(await decode(await urls.get(attachmentId))));
      return;
    } catch {
      // The URL may have expired between signing and loading; the second try signs a new one.
      urls.invalidate(attachmentId);
    }
  }
  setImage(attachmentId, { status: 'failed' });
}

/** Shows a file just uploaded without downloading it again. */
export async function showLocalImage(attachmentId: Id, file: Blob) {
  const url = URL.createObjectURL(file);
  try {
    // A decoded image keeps its pixels, so the URL is not needed afterwards.
    setImage(attachmentId, ready(await decode(url)));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function reloadImage(attachmentId: Id) {
  void load(attachmentId);
}

export const readyImageSize = (attachmentId: Id): ImageSize | null => {
  const image = imageStore.getState()[attachmentId];
  return image?.status === 'ready' ? image.size : null;
};

/** The image for an attachment, loading it on first use. */
export function useBackgroundImage(attachmentId: Id | undefined): BackgroundImage | undefined {
  const image = useStore(imageStore, (s) => (attachmentId ? s[attachmentId] : undefined));
  useEffect(() => {
    if (attachmentId && !imageStore.getState()[attachmentId]) void load(attachmentId);
  }, [attachmentId]);
  return image;
}
