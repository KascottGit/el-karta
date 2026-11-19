import { combine, setBackground, setScale, type Id } from '@el-karta/core';
import { repository } from '@/features/projects/queries';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { backgroundUi, setUploadStep } from './background-store';
import { showLocalImage } from './images';
import { openPdf } from './pdf';
import { classifyPlanFile } from './plan-file';

/** Starts using a picked file as the floor's background: an image directly, a PDF after picking a page. */
export async function startPlanUpload(file: File, ctx: CanvasContext) {
  cancelUpload();
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
    if (pdf.pageCount === 1) await uploadPdfPage(pdf, 1, ctx);
    else setUploadStep({ step: 'pick-page', pdf });
  } catch {
    setUploadStep({ step: 'failed', reason: 'pdf' });
  }
}

/** Renders the chosen page to a PNG and uploads that; the PDF itself is not stored. */
export async function uploadPdfPage(
  pdf: { renderPng(page: number): Promise<Blob>; destroy(): void },
  page: number,
  ctx: CanvasContext,
) {
  setUploadStep({ step: 'rendering', page });
  let png: Blob;
  try {
    png = await pdf.renderPng(page);
  } catch {
    setUploadStep({ step: 'failed', reason: 'pdf' });
    return;
  } finally {
    pdf.destroy();
  }
  await uploadPlan(ctx, png, 'png', 'image/png', page);
}

export function cancelUpload() {
  const { upload } = backgroundUi.getState();
  if (upload.step === 'pick-page') upload.pdf.destroy();
  setUploadStep({ step: 'idle' });
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
  pdfPage?: number,
) {
  const floorId: Id = ctx.floorId;
  const floor = modelStore.getState().model?.floors[floorId];
  if (!floor) return;
  setUploadStep({ step: 'uploading' });
  const attachmentId = crypto.randomUUID();
  try {
    await repository.uploadAttachment({
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
  await showLocalImage(attachmentId, file).catch(() => undefined);
  if (!modelStore.getState().model?.floors[floorId]) return;
  modelStore.getState().apply(
    combine(
      setBackground(floorId, {
        attachmentId,
        ...(pdfPage === undefined ? {} : { pdfPage }),
        offset: { x: 0, y: 0 },
        rotation: 0,
      }),
      setScale(floorId, null),
    ),
  );
  setUploadStep({ step: 'idle' });
  if (editorStore.getState().floorId === floorId) ctx.zoomToFit();
}
