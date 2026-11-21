import { pdfRenderScale } from '@el-karta/ai-passes';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlanImage } from './pipeline.ts';

const PDFJS = 'pdfjs-dist/legacy/build/pdf.mjs';
const POINTS_PER_MM = 72 / 25.4;

async function renderPdfPage(data: Uint8Array, pageNumber: number) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Browsers draw non-embedded standard fonts with system fonts; Node needs pdf.js's own copies.
  const fonts = join(dirname(fileURLToPath(import.meta.resolve(PDFJS))), '../../standard_fonts/');
  const task = pdfjs.getDocument({ data, standardFontDataUrl: fonts });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNumber);
    const unit = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: pdfRenderScale(unit.width, unit.height) });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    // Same call as the app's `openPdf`; pdf.js's types expect a DOM canvas.
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
    page.cleanup();
    return { canvas, pageWidthMm: unit.width / POINTS_PER_MM };
  } finally {
    await task.destroy();
  }
}

async function decodeImage(data: Buffer): Promise<Canvas> {
  const image = await loadImage(data);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas;
}

/**
 * A plan file as the app shows it: a PDF page rendered with the app's `pdfRenderScale`, or an image
 * at its own size. Regions are sent as PNG, as the browser's canvas crop does.
 */
export async function loadPlanImage(path: string, page: number): Promise<PlanImage> {
  const data = await readFile(path);
  const pdf = extname(path).toLowerCase() === '.pdf';
  const { canvas, pageWidthMm } = pdf
    ? await renderPdfPage(new Uint8Array(data), page)
    : { canvas: await decodeImage(data), pageWidthMm: undefined };
  return {
    width: canvas.width,
    height: canvas.height,
    pdfPageWidthMm: pageWidthMm,
    encode: (region) => {
      const out = createCanvas(region.width, region.height);
      out.getContext('2d').drawImage(canvas, -region.x, -region.y);
      return Promise.resolve({
        mimeType: 'image/png',
        data: out.toBuffer('image/png').toString('base64'),
      });
    },
  };
}
