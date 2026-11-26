/** A rectangle of a source image, in its pixels. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`The image could not be encoded as ${type}`));
      },
      type,
      quality,
    );
  });
}

/** The blob's bytes as base64, without the data-URL prefix. */
export function blobToBase64(blob: Blob): Promise<string> {
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

/**
 * Draws `region` of `source` at `scale` on a white canvas and encodes it. Transparent parts would
 * turn black in a JPEG, hence the white.
 */
export async function encodeRegion(
  source: CanvasImageSource,
  region: Region,
  scale: number,
  type: string,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas');
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
    return await canvasToBlob(canvas, type, quality);
  } finally {
    // Frees the bitmap now rather than whenever the canvas is collected.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** The scale that fits a `width` × `height` image within `maxSide` pixels on its long side, never above 1. */
export const scaleToFit = (width: number, height: number, maxSide: number): number =>
  Math.min(1, maxSide / Math.max(width, height, 1));

/**
 * Tries `encodings` in order and returns the first whose base64 is at most `limit` characters, or
 * null when none fits.
 */
export async function firstFitting<E>(
  encodings: readonly E[],
  render: (encoding: E) => Promise<string>,
  limit: number,
): Promise<{ encoding: E; data: string } | null> {
  for (const encoding of encodings) {
    const data = await render(encoding);
    if (data.length <= limit) return { encoding, data };
  }
  return null;
}
