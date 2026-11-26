import { PHOTO_QUALITY } from '@el-karta/ai-passes';
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';

/** A photo file, decoded once, that encodes as base64 JPEG at most `maxSide` pixels on its long side. */
export interface PhotoFile {
  width: number;
  height: number;
  encode(maxSide: number): Promise<string>;
}

/**
 * Decodes a photo as the app does on upload: turned upright by its EXIF orientation (which
 * `@napi-rs/canvas` applies, like `createImageBitmap` with `imageOrientation: 'from-image'`), then
 * scaled to fit and re-encoded as JPEG at the app's quality on a white canvas (`encodeRegion`).
 */
export async function loadPhotoFile(path: string): Promise<PhotoFile> {
  const image: Image = await loadImage(await readFile(path));
  const { width, height } = image;
  return {
    width,
    height,
    encode: async (maxSide) => {
      const scale = Math.min(1, maxSide / Math.max(width, height, 1));
      const canvas = createCanvas(
        Math.max(1, Math.round(width * scale)),
        Math.max(1, Math.round(height * scale)),
      );
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return (await canvas.encode('jpeg', Math.round(PHOTO_QUALITY * 100))).toString('base64');
    },
  };
}
