import { pdfRenderScale } from '@el-karta/ai-passes';

/** An opened PDF whose pages can be rendered to images. Call `destroy` when done. */
export interface PdfFile {
  pageCount: number;
  /** A small PNG of the page as a data URL, for picking it. */
  thumbnail(page: number, longSide: number): Promise<string>;
  /** The page as a PNG at tracing resolution. */
  renderPng(page: number): Promise<Blob>;
  destroy(): void;
}

// pdf.js is large, so it loads only when someone picks a PDF.
async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The page could not be encoded as PNG'));
    }, 'image/png');
  });
}

export async function openPdf(file: Blob): Promise<PdfFile> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise.catch(async (error: unknown) => {
    await task.destroy();
    throw error;
  });

  async function render(pageNumber: number, scaleFor: (w: number, h: number) => number) {
    const page = await doc.getPage(pageNumber);
    const unit = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: scaleFor(unit.width, unit.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    page.cleanup();
    return canvas;
  }

  return {
    pageCount: doc.numPages,
    thumbnail: async (page, longSide) =>
      (await render(page, (w, h) => longSide / Math.max(w, h))).toDataURL('image/png'),
    renderPng: async (page) => {
      const canvas = await render(page, (w, h) => pdfRenderScale(w, h));
      const blob = await toPngBlob(canvas);
      // Frees the large bitmap now rather than whenever the canvas is collected.
      canvas.width = 0;
      canvas.height = 0;
      return blob;
    },
    destroy: () => {
      void task.destroy();
    },
  };
}
