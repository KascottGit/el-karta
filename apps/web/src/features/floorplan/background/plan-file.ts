import { imageToWorld, type BackgroundPlacement } from '@el-karta/core';
import { boundsOf, type Rect } from '../canvas/rect';

/** File types accepted as a floor plan, for the file picker's `accept`. */
export const PLAN_FILE_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.pdf';

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export type PlanFile =
  | { kind: 'image'; extension: string; contentType: string }
  | { kind: 'pdf' }
  | { kind: 'unsupported' };

/** What to do with a picked file. Some phones give PDFs an empty type, so the name counts too. */
export function classifyPlanFile(file: { name: string; type: string }): PlanFile {
  if (file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name)))
    return { kind: 'pdf' };
  const extension = IMAGE_EXTENSIONS[file.type];
  return extension ? { kind: 'image', extension, contentType: file.type } : { kind: 'unsupported' };
}

export interface ImageSize {
  width: number;
  height: number;
}

/** The four corners of the image in the plan, clockwise from its top-left corner. */
export const imageCorners = (placement: BackgroundPlacement, size: ImageSize) =>
  [
    { x: 0, y: 0 },
    { x: size.width, y: 0 },
    { x: size.width, y: size.height },
    { x: 0, y: size.height },
  ].map((px) => imageToWorld(placement, px));

export const imageBounds = (placement: BackgroundPlacement, size: ImageSize): Rect | null =>
  boundsOf(imageCorners(placement, size));

export const imageCenter = (size: ImageSize) => ({ x: size.width / 2, y: size.height / 2 });
