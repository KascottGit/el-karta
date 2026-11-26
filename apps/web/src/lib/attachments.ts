import type { Id } from '@el-karta/core';
import type { Attachment, AttachmentKind, NewAttachment, SignedUrl } from '@el-karta/data-supabase';
import { createSignedUrlCache } from './signed-urls';

// Loaded on first use, so the editor's extensions can be imported without a Supabase client, as
// unit tests and the synthetic dev page do.
const repository = async () => (await import('@/features/projects/queries')).repository;

export const uploadAttachment = async (attachment: NewAttachment) =>
  (await repository()).uploadAttachment(attachment);

export const attachmentUrl = async (attachmentId: Id): Promise<SignedUrl> =>
  (await repository()).attachmentUrl(attachmentId);

export const listAttachments = async (floorId: Id, kind: AttachmentKind): Promise<Attachment[]> =>
  (await repository()).listAttachments(floorId, kind);

export const deleteAttachment = async (attachmentId: Id): Promise<{ fileRemoved: boolean }> =>
  (await repository()).deleteAttachment(attachmentId);

/** One signed-URL cache for every attachment shown in the app (floor plans and photos). */
export const attachmentUrls = createSignedUrlCache(attachmentUrl);
