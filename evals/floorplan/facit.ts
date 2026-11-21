import { dominantOrientation } from '@el-karta/ai-passes';
import {
  Opening,
  Pt,
  RoomType,
  signedArea,
  worldToImage,
  type FloorData,
  type FloorScale,
} from '@el-karta/core';
import { z } from 'zod';

export const ManifestPlan = z.object({
  id: z.string().min(1),
  /** File name inside the manifest's `imagesDir`. */
  file: z.string().min(1),
  page: z.int().positive(),
  source: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ManifestPlan = z.infer<typeof ManifestPlan>;

export const Manifest = z.object({
  /** Relative to the manifest file. */
  imagesDir: z.string().min(1),
  plans: z.array(ManifestPlan),
});
export type Manifest = z.infer<typeof Manifest>;

export const FacitRoom = z.object({
  /** As printed; null when the room has no label, so any found room matches it by name. */
  name: z.string().nullable(),
  /** The room types that count as correct. */
  types: z.array(RoomType).min(1),
  /** Printed (light) or measured (full) area in m². */
  area: z.number().positive().nullable(),
});
export type FacitRoom = z.infer<typeof FacitRoom>;

export const FacitScale = z.object({
  /** The real-world width the whole image covers, so it holds at any render resolution. */
  metresPerImageWidth: z.number().positive(),
  evidence: z.array(z.string()),
});
export type FacitScale = z.infer<typeof FacitScale>;

const facitBase = {
  id: z.string().min(1),
  checked: z.boolean(),
  /**
   * How far the walls are turned from the image axes, in degrees in (-45, 45]: the angle of the
   * main wall direction in image coordinates (x right, y down), so positive is clockwise on screen.
   */
  rotationDeg: z.number().gt(-45).lte(45),
  scale: FacitScale.nullable(),
  totalArea: z.number().positive().nullable(),
  ceilingHeight: z.number().positive().nullable(),
  rooms: z.array(FacitRoom),
  /** Doors, excluding wardrobe and cupboard doors; a double door counts once. */
  doors: z.int().nonnegative(),
  windows: z.int().nonnegative().optional(),
};

export const LightFacit = z.object({ ...facitBase, level: z.literal('light') });
export type LightFacit = z.infer<typeof LightFacit>;

/**
 * Metres in the image's own frame: origin at the image's top-left corner, x along its width, y down
 * its height, unturned. The same frame the eval runner interprets in (placement at the image origin).
 */
export const FacitWall = z.object({ a: Pt, b: Pt, thickness: z.number().positive() });
export type FacitWall = z.infer<typeof FacitWall>;

export const FacitOpening = Opening.pick({ kind: true, offset: true, width: true }).extend({
  /** Index into `walls`. */
  wall: z.int().nonnegative(),
});
export type FacitOpening = z.infer<typeof FacitOpening>;

/** The floor as a person corrected it in the editor, exported with "Exportera facit". */
export const FullFacit = z.object({
  ...facitBase,
  level: z.literal('full'),
  scale: FacitScale,
  image: z.object({ width: z.number().positive(), height: z.number().positive() }),
  rooms: z.array(FacitRoom.extend({ polygon: z.array(Pt) })),
  walls: z.array(FacitWall),
  openings: z.array(FacitOpening),
  windows: z.int().nonnegative(),
});
export type FullFacit = z.infer<typeof FullFacit>;

export const Facit = z.discriminatedUnion('level', [LightFacit, FullFacit]);
export type Facit = z.infer<typeof Facit>;

/** `FacitScale.metresPerImageWidth` of a metres-per-pixel scale on an image `width` pixels wide. */
export const metresPerImageWidth = (metresPerPixel: number, width: number) =>
  metresPerPixel * width;

/** The main wall direction in degrees, as `rotationDeg` defines it, or null without walls. */
export function wallRotationDeg(walls: readonly { a: Pt; b: Pt }[]): number | null {
  if (walls.length === 0) return null;
  const segments = walls.map(({ a, b }) => ({ a, b, thickness: 0, exterior: false }));
  return (dominantOrientation(segments) * 180) / Math.PI;
}

export interface FacitExportInput {
  id: string;
  floor: Pick<FloorData, 'walls' | 'openings' | 'rooms' | 'background' | 'scale'>;
  /** The background image's size in pixels. */
  image: { width: number; height: number };
}

// `+ 0` turns -0 into 0, which JSON would otherwise write as 0 but tests tell apart.
const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits + 0;

/**
 * The full facit for a corrected floor: everything moved into the image frame (see `FacitWall`), so
 * it compares with an eval run whatever the floor's background placement is. Null when the floor
 * has no background or no scale, since without them the metres mean nothing.
 */
export function floorToFacit({ id, floor, image }: FacitExportInput): FullFacit | null {
  const { background, scale } = floor;
  if (!background || !scale) return null;
  const toImage = imageFrame(background, scale);
  const wallIds = Object.keys(floor.walls);
  const walls = Object.values(floor.walls).map((w) => ({
    a: toImage(w.a),
    b: toImage(w.b),
    thickness: w.thickness,
  }));
  const openings = Object.values(floor.openings).flatMap((o) => {
    const wall = wallIds.indexOf(o.wallId);
    return wall < 0 ? [] : [{ kind: o.kind, offset: o.offset, width: o.width, wall }];
  });
  const rooms = Object.values(floor.rooms).map((r) => {
    const polygon = r.polygon.map(toImage);
    const area = round(Math.abs(signedArea(polygon)), 2);
    return {
      name: r.name.trim() === '' ? null : r.name,
      types: [r.type],
      area: area > 0 ? area : null,
      polygon,
    };
  });
  const rotation = round(wallRotationDeg(walls) ?? 0, 2);
  return FullFacit.parse({
    id,
    level: 'full',
    checked: true,
    rotationDeg: rotation <= -45 ? 45 : rotation,
    scale: {
      metresPerImageWidth: round(metresPerImageWidth(scale.metresPerPixel, image.width)),
      evidence: [`editor scale (${scale.source})`],
    },
    totalArea: null,
    ceilingHeight: null,
    image,
    rooms,
    walls,
    openings,
    doors: openings.filter((o) => o.kind === 'door').length,
    windows: openings.filter((o) => o.kind === 'window').length,
  });
}

function imageFrame(background: NonNullable<FloorData['background']>, scale: FloorScale) {
  const placement = { ...background, metresPerPixel: scale.metresPerPixel };
  return (p: Pt): Pt => {
    const px = worldToImage(placement, p);
    return {
      x: round(px.x * scale.metresPerPixel),
      y: round(px.y * scale.metresPerPixel),
    };
  };
}
