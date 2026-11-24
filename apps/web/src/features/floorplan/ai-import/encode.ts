import type { LocateInput, PlanImage, Tile } from '@el-karta/ai-passes';
import { AI_PASS_MAX_BODY_BYTES } from '@el-karta/data-supabase';
import { blobToBase64, encodeRegion, firstFitting } from '@/lib/image-encoding';
import { ImportError } from './errors';

type ImageInput = LocateInput['image'];

/** Room for the rest of a run request (pass, ids, frame) besides the base64 image. */
const REQUEST_ALLOWANCE = 64 * 1024;
export const MAX_IMAGE_CHARS = AI_PASS_MAX_BODY_BYTES - REQUEST_ALLOWANCE;

export interface Encoding {
  mimeType: 'image/png' | 'image/jpeg';
  /** Fraction of the region's pixel size. Coordinates are normalised, so a smaller image is fine. */
  scale: number;
}

/**
 * Tried in order until one fits the function's body cap: plans are line drawings, so PNG at full
 * size is both sharpest and usually small; JPEG and then fewer pixels are the fallbacks.
 */
export const ENCODINGS: readonly Encoding[] = [
  { mimeType: 'image/png', scale: 1 },
  { mimeType: 'image/jpeg', scale: 1 },
  { mimeType: 'image/jpeg', scale: 0.7 },
  { mimeType: 'image/jpeg', scale: 0.5 },
  { mimeType: 'image/jpeg', scale: 0.35 },
];

/** The first encoding whose base64 fits in `limit` characters. */
export async function encodeWithin(
  render: (encoding: Encoding) => Promise<string>,
  limit = MAX_IMAGE_CHARS,
): Promise<ImageInput> {
  const found = await firstFitting(ENCODINGS, render, limit);
  if (!found) throw new ImportError('too_large');
  return { mimeType: found.encoding.mimeType, data: found.data };
}

const JPEG_QUALITY = 0.85;

/** The loaded background image as the passes read it: regions are cut out with a canvas. */
export const canvasPlanImage = (
  source: CanvasImageSource,
  size: { width: number; height: number },
  pdfPageWidthMm: number | undefined,
): PlanImage => ({
  ...size,
  pdfPageWidthMm,
  encode: (region: Tile) =>
    encodeWithin(async (encoding) =>
      blobToBase64(
        await encodeRegion(source, region, encoding.scale, encoding.mimeType, JPEG_QUALITY),
      ),
    ),
});
