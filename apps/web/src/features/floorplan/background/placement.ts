import {
  backgroundPlacement,
  combine,
  imageToWorld,
  metresPerPixelFrom,
  setBackground,
  setScale,
  transformAbout,
  worldToImage,
  type BackgroundPlacement,
  type Edit,
  type FloorData,
  type Id,
  type Pt,
} from '@el-karta/core';
import { imageCenter, type ImageSize } from './plan-file';

type BackgroundData = Pick<FloorData, 'background' | 'scale'>;

/** Degrees in (-180, 180], so typed and dragged rotations read the same way. */
export function normalizeDegrees(degrees: number): number {
  const turned = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return turned === -180 ? 180 : turned;
}

/** Stores a moved or turned placement. The scale is unchanged, so only the image moves. */
export function placeBackground(
  floorId: Id,
  data: BackgroundData,
  placement: Pick<BackgroundPlacement, 'offset' | 'rotation'>,
): Edit | null {
  if (!data.background) return null;
  return setBackground(floorId, {
    ...data.background,
    offset: placement.offset,
    rotation: normalizeDegrees(placement.rotation),
  });
}

/** The placement turned to `rotation` degrees about the image's centre (its corner while the size is unknown). */
export function rotatedAboutCenter(
  placement: BackgroundPlacement,
  rotation: number,
  size: ImageSize | null,
): BackgroundPlacement {
  return transformAbout(placement, size ? imageCenter(size) : { x: 0, y: 0 }, { rotation });
}

export interface MeasuredScale {
  edit: Edit;
  metresPerPixel: number;
  /** The plan point that stays put: the middle of the measurement. */
  pivot: Pt;
  /** How much larger the image now is in the plan; zooming the view by its inverse keeps it steady on screen. */
  growth: number;
}

/**
 * The scale from two points (in plan metres, as clicked on the image) that are `metres` apart in
 * reality: `scale` with source 'user', and the background moved so the measurement's middle stays
 * where it is. Null without a background or when the measurement is unusable.
 */
export function measuredScale(
  floorId: Id,
  data: BackgroundData,
  a: Pt,
  b: Pt,
  metres: number,
): MeasuredScale | null {
  const placement = backgroundPlacement(data.background, data.scale);
  if (!placement || !data.background) return null;
  const pa = worldToImage(placement, a);
  const pb = worldToImage(placement, b);
  const metresPerPixel = metresPerPixelFrom(pa, pb, metres);
  if (metresPerPixel === null) return null;
  const pivotPx = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  const next = transformAbout(placement, pivotPx, { metresPerPixel });
  return {
    edit: combine(
      setBackground(floorId, { ...data.background, offset: next.offset }),
      setScale(floorId, { source: 'user', metresPerPixel }),
    ),
    metresPerPixel,
    pivot: imageToWorld(placement, pivotPx),
    growth: metresPerPixel / placement.metresPerPixel,
  };
}
