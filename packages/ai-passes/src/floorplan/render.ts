/** Long side of a rendered PDF page in pixels: fine enough to trace thin walls and read dimensions. */
export const PDF_LONG_SIDE = 4000;
/** Stays under iOS Safari's canvas limit of 16.7 megapixels, and keeps memory in check on phones. */
export const PDF_MAX_PIXELS = 16_000_000;

/**
 * The pdf.js render scale for a page of `width` × `height` PDF units at scale 1: the long side
 * becomes `longSide` pixels, unless that would exceed `maxPixels`. The app and the eval runner both
 * render with it, so evals see the image the app sends.
 */
export function pdfRenderScale(
  width: number,
  height: number,
  longSide = PDF_LONG_SIDE,
  maxPixels = PDF_MAX_PIXELS,
): number {
  const byLongSide = longSide / Math.max(width, height);
  const byArea = Math.sqrt(maxPixels / (width * height));
  return Math.min(byLongSide, byArea);
}
