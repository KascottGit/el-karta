import { z } from 'zod';
import { Id } from './primitives.ts';

/**
 * What a photo shows, stored in `attachments.region` (M11 decision 3): the room it was taken in
 * and, when it faces one wall, that wall. Without `wallId` it shows the room in general or its
 * ceiling.
 */
export const AttachmentRegion = z.object({
  roomId: Id,
  wallId: Id.optional(),
});
export type AttachmentRegion = z.infer<typeof AttachmentRegion>;
