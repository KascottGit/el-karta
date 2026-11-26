import type { ImageInput } from '@el-karta/ai-providers';
import type { Issue } from '@el-karta/core';
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

/** Coordinates a little outside 0–`NORM` are rounding and get clamped; further out is a misreading. */
export const NORM_SLACK = 10;

export const outsideImage = (p: NormPoint): boolean =>
  p.x < -NORM_SLACK || p.y < -NORM_SLACK || p.x > NORM + NORM_SLACK || p.y > NORM + NORM_SLACK;

export const clampNorm = (p: NormPoint): NormPoint => ({
  x: Math.min(NORM, Math.max(0, p.x)),
  y: Math.min(NORM, Math.max(0, p.y)),
});

/** What is wrong with a box read off an image, if anything. */
export function boxProblem(box: NormBox): 'outside' | 'inverted' | null {
  if (outsideImage({ x: box.xmin, y: box.ymin }) || outsideImage({ x: box.xmax, y: box.ymax }))
    return 'outside';
  if (box.xmax <= box.xmin || box.ymax <= box.ymin) return 'inverted';
  return null;
}

/** A validation issue about the output as a whole (`ids` empty), as passes' `validate` returns. */
export const issue = (
  code: string,
  severity: Issue['severity'],
  params?: Record<string, string | number>,
): Issue => ({ code, severity, ids: [], ...(params ? { params } : {}) });

export const ImageInputSchema = z.object({
  mimeType: z.string().min(1),
  data: z.string().min(1),
}) satisfies z.ZodType<ImageInput>;
