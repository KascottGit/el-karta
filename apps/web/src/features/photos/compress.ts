import { encodeRegion, scaleToFit } from '@/lib/image-encoding';

/** Long side of a stored photo, in pixels (M11 decision 3). */
export const PHOTO_MAX_SIDE = 2048;
export const PHOTO_QUALITY = 0.8;
export const PHOTO_TYPE = 'image/jpeg';
export const PHOTO_EXTENSION = 'jpg';

export interface PhotoCodec {
  decode(file: Blob, options: ImageBitmapOptions): Promise<ImageBitmap>;
  encode: typeof encodeRegion;
}

const browserCodec: PhotoCodec = {
  decode: (file, options) => createImageBitmap(file, options),
  encode: encodeRegion,
};

/**
 * Turns a picked photo upright by its EXIF orientation, shrinks it to `PHOTO_MAX_SIDE` and
 * re-encodes it as JPEG. Re-encoding drops the EXIF data, GPS position included.
 */
export async function compressPhoto(file: Blob, codec: PhotoCodec = browserCodec): Promise<Blob> {
  const bitmap = await codec.decode(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = bitmap;
    const scale = scaleToFit(width, height, PHOTO_MAX_SIDE);
    return await codec.encode(
      bitmap,
      { x: 0, y: 0, width, height },
      scale,
      PHOTO_TYPE,
      PHOTO_QUALITY,
    );
  } finally {
    bitmap.close();
  }
}
