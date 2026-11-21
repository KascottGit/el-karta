import type { LocateInput, PlanImage, Tile } from '@el-karta/ai-passes';
import { AI_PASS_MAX_BODY_BYTES } from '@el-karta/data-supabase';
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
  for (const encoding of ENCODINGS) {
    const data = await render(encoding);
    if (data.length <= limit) return { mimeType: encoding.mimeType, data };
  }
  throw new ImportError('too_large');
}

const JPEG_QUALITY = 0.85;

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`The image could not be encoded as ${type}`));
      },
      type,
      JPEG_QUALITY,
    );
  });
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('The image could not be read'));
    };
    reader.readAsDataURL(blob);
  });
}

async function renderRegion(source: CanvasImageSource, region: Tile, encoding: Encoding) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.width * encoding.scale));
  canvas.height = Math.max(1, Math.round(region.height * encoding.scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas');
  // Transparent parts would turn black in a JPEG.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    source,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  try {
    return await base64(await toBlob(canvas, encoding.mimeType));
  } finally {
    // Frees the bitmap now rather than whenever the canvas is collected.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** The loaded background image as the passes read it: regions are cut out with a canvas. */
export const canvasPlanImage = (
  source: CanvasImageSource,
  size: { width: number; height: number },
  pdfPageWidthMm: number | undefined,
): PlanImage => ({
  ...size,
  pdfPageWidthMm,
  encode: (region) => encodeWithin((encoding) => renderRegion(source, region, encoding)),
});
