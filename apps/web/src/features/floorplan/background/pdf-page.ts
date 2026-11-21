import type { Id } from '@el-karta/core';
import { z } from 'zod';
import { storageJson, type ProjectJson } from './project-json';

/**
 * The paper size of the PDF page a background was rendered from. A printed ratio such as
 * "Skala 1:100" only gives a scale together with it (M4 decision 2), and the rendered PNG does not
 * keep it, so it is stored beside the attachment when the page is uploaded.
 */
export const PdfPageSize = z.object({
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
});
export type PdfPageSize = z.infer<typeof PdfPageSize>;

const name = (attachmentId: Id) => `${attachmentId}.pdf-page`;

export const savePdfPageSize = (
  projectId: Id,
  attachmentId: Id,
  size: PdfPageSize,
  files: ProjectJson = storageJson,
) => files.save(projectId, name(attachmentId), size);

/** Null for images that are not PDF pages, and for pages uploaded before the size was stored. */
export const loadPdfPageSize = (
  projectId: Id,
  attachmentId: Id,
  files: ProjectJson = storageJson,
) => files.load(projectId, name(attachmentId), PdfPageSize);
