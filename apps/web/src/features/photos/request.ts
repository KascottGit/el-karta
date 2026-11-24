import type { PhotoInput } from '@el-karta/ai-passes';
import { AI_PASS_MAX_BODY_BYTES } from '@el-karta/data-supabase';
import { AiPassFailure } from '@/lib/ai-pass';
import { blobToBase64, encodeRegion, firstFitting, scaleToFit } from '@/lib/image-encoding';
import { PHOTO_QUALITY, PHOTO_TYPE } from './compress';
import type { PhotoContext } from './context';

type ImageInput = PhotoInput['image'];

/**
 * A photo to send, as base64 JPEG at most `maxSide` pixels on its long side, or as stored when
 * `maxSide` is null.
 */
export interface PhotoImage {
  encode(maxSide: number | null): Promise<string>;
}

/** Tried in order for the photo being read: as stored (2048 px), then smaller. */
export const MAIN_SIDES: readonly (number | null)[] = [null, 1600, 1280, 1024];
/** Earlier photos are context only (M11 decision 7). */
export const EARLIER_SIDES: readonly number[] = [1024, 768, 512];

/** Room for the request around its input (action, pass, ids) and JSON escaping, in bytes. */
const REQUEST_ALLOWANCE = 4 * 1024;

const utf8Length = (text: string) => new TextEncoder().encode(text).length;
const asInput = (data: string): ImageInput => ({ mimeType: PHOTO_TYPE, data });

/**
 * The run input for a photo with its context and earlier photos, within the function's body cap:
 * the photo as large as fits, then each earlier photo (in the order given) at the largest size that
 * still fits in what is left; an earlier photo that does not fit at all is left out. Throws
 * `AiPassFailure('too_large')` when even the smallest photo does not fit.
 */
export async function photoRunInput(
  context: PhotoContext,
  photo: PhotoImage,
  earlier: readonly PhotoImage[],
  limit = AI_PASS_MAX_BODY_BYTES,
): Promise<PhotoInput> {
  const empty: PhotoInput = { ...context, image: asInput(''), earlier: [] };
  let left = limit - REQUEST_ALLOWANCE - utf8Length(JSON.stringify(empty));
  const main = await firstFitting(MAIN_SIDES, (side) => photo.encode(side), left);
  if (!main) throw new AiPassFailure('too_large');
  left -= main.data.length;
  const perImage = utf8Length(JSON.stringify(asInput(''))) + 1;
  const sent: ImageInput[] = [];
  for (const image of earlier) {
    const found = await firstFitting(EARLIER_SIDES, (side) => image.encode(side), left - perImage);
    if (!found) break;
    left -= found.data.length + perImage;
    sent.push(asInput(found.data));
  }
  return { ...context, image: asInput(main.data), earlier: sent };
}

/** A stored photo's file as a `PhotoImage`: sent as it is, or decoded and re-encoded smaller. */
export const blobPhotoImage = (blob: Blob): PhotoImage => ({
  async encode(maxSide) {
    if (maxSide === null) return blobToBase64(blob);
    const bitmap = await createImageBitmap(blob);
    try {
      const { width, height } = bitmap;
      return await blobToBase64(
        await encodeRegion(
          bitmap,
          { x: 0, y: 0, width, height },
          scaleToFit(width, height, maxSide),
          PHOTO_TYPE,
          PHOTO_QUALITY,
        ),
      );
    } finally {
      bitmap.close();
    }
  },
});
