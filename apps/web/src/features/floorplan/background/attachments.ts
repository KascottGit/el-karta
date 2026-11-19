import type { Id } from '@el-karta/core';
import type { NewAttachment, SignedUrl } from '@el-karta/data-supabase';

// Loaded on first use, so the editor's extensions can be imported without a Supabase client, as
// unit tests and the synthetic dev page do.
const repository = async () => (await import('@/features/projects/queries')).repository;

export const uploadAttachment = async (attachment: NewAttachment) =>
  (await repository()).uploadAttachment(attachment);

export const attachmentUrl = async (attachmentId: Id): Promise<SignedUrl> =>
  (await repository()).attachmentUrl(attachmentId);
