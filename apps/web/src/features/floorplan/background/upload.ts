import { combine, setBackground, setScale, type Id } from '@el-karta/core';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { uploadAttachment } from '@/lib/attachments';
import { backgroundUi, setUploadStep } from './background-store';
import { showLocalImage } from './images';
import { openPdf, type PdfFile } from './pdf';
import { savePdfPageSize, type PdfPageSize } from './pdf-page';
import { classifyPlanFile } from './plan-file';

// Bumped when a PDF being opened or picked from is abandoned, so a late open is thrown away.
let pdfAttempt = 0;

/** Starts using a picked file as the floor's background: an image directly, a PDF after picking a page. */
export async function startPlanUpload(file: File, ctx: CanvasContext) {
  cancelUpload();
  const attempt = pdfAttempt;
  const type = classifyPlanFile(file);
  if (type.kind === 'unsupported') {
    setUploadStep({ step: 'failed', reason: 'unsupported' });
    return;
  }
  if (type.kind === 'image') {
    await uploadPlan(ctx, file, type.extension, type.contentType);
    return;
  }
  setUploadStep({ step: 'reading' });
  try {
    const pdf = await openPdf(file);
    if (attempt !== pdfAttempt) {
      pdf.destroy();
      return;
    }
    if (pdf.pageCount === 1) await uploadPdfPage(pdf, 1, ctx);
    else setUploadStep({ step: 'pick-page', pdf });
  } catch {
    setUploadStep({ step: 'failed', reason: 'pdf' });
  }
}

/** Renders the chosen page to a PNG and uploads that; the PDF itself is not stored. */
export async function uploadPdfPage(
  pdf: Pick<PdfFile, 'renderPng' | 'pageSizeMm' | 'destroy'>,
  page: number,
  ctx: CanvasContext,
) {
  setUploadStep({ step: 'rendering', page });
  let png: Blob;
  let size: PdfPageSize | null;
  try {
    png = await pdf.renderPng(page);
    size = await pdf.pageSizeMm(page).catch(() => null);
  } catch {
    setUploadStep({ step: 'failed', reason: 'pdf' });
    return;
  } finally {
    pdf.destroy();
  }
  await uploadPlan(ctx, png, 'png', 'image/png', { page, size });
}

/**
 * Abandons a PDF being opened or waiting for a page choice, and clears a failure message. A page
 * being rendered or a file being uploaded carries on.
 */
export function cancelUpload() {
  const { upload } = backgroundUi.getState();
  if (upload.step === 'rendering' || upload.step === 'uploading') return;
  pdfAttempt++;
  if (upload.step === 'pick-page') upload.pdf.destroy();
  if (upload.step !== 'idle') setUploadStep({ step: 'idle' });
}

/**
 * Stores the file and its attachment row, then makes it the floor's background in one undoable
 * edit. A new image starts at the plan origin, unturned and unscaled: the old scale belonged to the
 * old image.
 */
async function uploadPlan(
  ctx: CanvasContext,
  file: Blob,
  extension: string,
  contentType: string,
  pdf?: { page: number; size: PdfPageSize | null },
) {
  const floorId: Id = ctx.floorId;
  const floor = modelStore.getState().model?.floors[floorId];
  if (!floor) return;
  setUploadStep({ step: 'uploading' });
  const attachmentId = crypto.randomUUID();
  try {
    await uploadAttachment({
      id: attachmentId,
      projectId: floor.projectId,
      floorId,
      kind: 'floorplan',
      extension,
      contentType,
      body: file,
    });
  } catch {
    setUploadStep({ step: 'failed', reason: 'upload' });
    return;
  }
  // Stored before the image becomes the background, so an import started at once finds it. Without
  // it a printed ratio only counts as unconfirmed, so a failure is not an error.
  if (pdf?.size)
    await savePdfPageSize(floor.projectId, attachmentId, pdf.size).catch(() => undefined);
  await showLocalImage(attachmentId, file).catch(() => undefined);
  if (!modelStore.getState().model?.floors[floorId]) return;
  modelStore.getState().apply(
    combine(
      setBackground(floorId, {
        attachmentId,
        ...(pdf === undefined ? {} : { pdfPage: pdf.page }),
        offset: { x: 0, y: 0 },
        rotation: 0,
      }),
      setScale(floorId, null),
    ),
  );
  setUploadStep({ step: 'idle' });
  if (editorStore.getState().floorId === floorId) ctx.zoomToFit();
}
