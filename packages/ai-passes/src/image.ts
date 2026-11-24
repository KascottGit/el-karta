import type { ImageInput } from '@el-karta/ai-providers';
import { z } from 'zod';

/** Image coordinates in pass outputs run from 0 to `NORM` on each axis. */
export const NORM = 1000;

/**
 * A point on the image that was sent, normalised to 0–1000 on each axis: x by the image's width, y
 * by its height, both from the top-left corner.
 */
export const NormPoint = z.object({ x: z.number(), y: z.number() });
export type NormPoint = z.infer<typeof NormPoint>;

/** A box in the same normalised coordinates as `NormPoint`. */
export const NormBox = z.object({
  xmin: z.number(),
  ymin: z.number(),
  xmax: z.number(),
  ymax: z.number(),
});
export type NormBox = z.infer<typeof NormBox>;

export const ImageInputSchema = z.object({
  mimeType: z.string().min(1),
  data: z.string().min(1),
}) satisfies z.ZodType<ImageInput>;
