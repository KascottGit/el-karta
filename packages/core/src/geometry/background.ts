import type { FloorData, Pt } from '../schemas/index.ts';
import { distance } from './vec.ts';

export type FloorBackground = NonNullable<FloorData['background']>;
export type FloorScale = NonNullable<FloorData['scale']>;

/**
 * Where a floor's background image lies in the plan. Image pixel (u, v), with v down as in the
 * image file, maps to `offset + R(rotation) · (u · metresPerPixel, v · metresPerPixel)` in metres:
 * `offset` is where the image's top-left corner lies, and `rotation` is in degrees, clockwise on
 * screen (x right, y down), about that corner. The same transform as a Konva node with these
 * `x`, `y`, `rotation` and `scale`.
 */
export interface BackgroundPlacement {
  offset: Pt;
  rotation: number;
  metresPerPixel: number;
}

/**
 * Shown until someone sets the scale: one centimetre per pixel puts a typical plan image at a
 * plausible building size, so it can be scaled without zooming far out or in first.
 */
export const DEFAULT_METRES_PER_PIXEL = 0.01;

/** The placement of the floor's background, or null when it has none. Without a scale it uses the default. */
export function backgroundPlacement(
  background: FloorBackground | undefined,
  scale: FloorScale | undefined,
): BackgroundPlacement | null {
  if (!background) return null;
  return {
    offset: background.offset,
    rotation: background.rotation,
    metresPerPixel: scale?.metresPerPixel ?? DEFAULT_METRES_PER_PIXEL,
  };
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function imageToWorld(placement: BackgroundPlacement, px: Pt): Pt {
  const { offset, rotation, metresPerPixel: k } = placement;
  const cos = Math.cos(radians(rotation));
  const sin = Math.sin(radians(rotation));
  const x = px.x * k;
  const y = px.y * k;
  return { x: offset.x + cos * x - sin * y, y: offset.y + sin * x + cos * y };
}

export function worldToImage(placement: BackgroundPlacement, world: Pt): Pt {
  const { offset, rotation, metresPerPixel: k } = placement;
  const cos = Math.cos(radians(rotation));
  const sin = Math.sin(radians(rotation));
  const dx = world.x - offset.x;
  const dy = world.y - offset.y;
  return { x: (cos * dx + sin * dy) / k, y: (-sin * dx + cos * dy) / k };
}

/**
 * The placement after changing rotation and/or scale while image pixel `pivot` stays where it is in
 * the plan, so the image turns or grows about a point the person is looking at, not its corner.
 */
export function transformAbout(
  placement: BackgroundPlacement,
  pivot: Pt,
  change: { rotation?: number; metresPerPixel?: number },
): BackgroundPlacement {
  const fixed = imageToWorld(placement, pivot);
  const next = {
    rotation: change.rotation ?? placement.rotation,
    metresPerPixel: change.metresPerPixel ?? placement.metresPerPixel,
  };
  const moved = imageToWorld({ ...next, offset: { x: 0, y: 0 } }, pivot);
  return { ...next, offset: { x: fixed.x - moved.x, y: fixed.y - moved.y } };
}

/** Shorter than this, in image pixels, a measurement is too imprecise to set a scale from. */
export const MIN_MEASURED_PIXELS = 2;

/**
 * Metres per image pixel from two image points a known `metres` apart, or null if the points are
 * too close together or the length is not a positive number.
 */
export function metresPerPixelFrom(a: Pt, b: Pt, metres: number): number | null {
  const pixels = distance(a, b);
  if (pixels < MIN_MEASURED_PIXELS || !(metres > 0) || !Number.isFinite(metres)) return null;
  return metres / pixels;
}
