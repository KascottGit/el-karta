import { deviceTypeKey, roomWalls, type PhotoDetectableInput } from '@el-karta/ai-passes';
import { Id, type FloorRecord } from '@el-karta/core';
import { z } from 'zod';

export const PhotoManifestEntry = z.object({
  /** File name inside the manifest's `imagesDir`: `<home>-<room>-<n>.jpg`, lower case. */
  file: z.string().regex(/^[a-z0-9][a-z0-9-]*\.(jpg|jpeg)$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** The floor the photo was taken on: `floors/<home>.json`. */
  home: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
});
export type PhotoManifestEntry = z.infer<typeof PhotoManifestEntry>;

export const PhotoManifest = z
  .object({
    /** Relative to the manifest file. */
    imagesDir: z.string().min(1),
    photos: z.array(PhotoManifestEntry),
  })
  .refine((m) => new Set(m.photos.map(photoName)).size === m.photos.length, {
    message: 'Two photos have the same name',
  });
export type PhotoManifest = z.infer<typeof PhotoManifest>;

/** A photo's name: its file without the extension. It names the facit file and the CSV row. */
export const photoName = (photo: Pick<PhotoManifestEntry, 'file'>) =>
  photo.file.replace(/\.[^.]+$/, '');

/** Where a device is: a wall id in the floor JSON, or the ceiling. */
export const FacitPlace = z.union([Id, z.literal('ceiling')]);
export type FacitPlace = z.infer<typeof FacitPlace>;

export const FacitDevice = z
  .object({
    /** `<domain>.<type>` (`deviceTypeKey`), e.g. `power.outlet`. */
    type: z.string().regex(/^[a-z0-9_-]+\.[a-z0-9_-]+$/),
    wall: FacitPlace,
    /** Units in one frame (`Device.count`), e.g. 2 for a double outlet. */
    count: z.int().positive().optional(),
    /** Props as seen; only the type's visible props are scored. */
    props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    /** Metres along the wall from its `a` end to the device's centre (`WallPlacement.offset`). */
    offset: z.number().nonnegative().optional(),
    /** Metres from the floor to the device's centre (`WallPlacement.height`). */
    height: z.number().nonnegative().optional(),
  })
  .strict()
  .refine((d) => d.wall !== 'ceiling' || (d.offset === undefined && d.height === undefined), {
    message: 'A ceiling device has no offset or height',
  });
export type FacitDevice = z.infer<typeof FacitDevice>;

/** What one photo shows (format in `evals/photo/README.md`). */
export const PhotoFacit = z
  .object({
    /** The room the photo was taken in: its id in the floor JSON. */
    room: Id,
    /** The wall the photo faces, or null for the room in general or its ceiling. */
    wall: Id.nullable(),
    /** Every visible device of a detectable type, also ones already in the model. */
    devices: z.array(FacitDevice),
    notes: z.string(),
  })
  .strict();
export type PhotoFacit = z.infer<typeof PhotoFacit>;

/**
 * What in a facit does not fit its floor or the detectable types: an unknown room or one without
 * walls, a wall that does not border the room, an unknown type, or a type on the wrong kind of place.
 */
export function facitProblems(
  facit: PhotoFacit,
  floor: FloorRecord,
  detectable: readonly PhotoDetectableInput[],
): string[] {
  if (!floor.data.rooms[facit.room]) return [`room ${facit.room} is not on the floor`];
  const walls = new Set(roomWalls(floor.data, facit.room).map((w) => w.id));
  if (walls.size === 0) return [`room ${facit.room} has no walls`];
  const problems: string[] = [];
  if (facit.wall !== null && !walls.has(facit.wall))
    problems.push(`wall ${facit.wall} does not border the room`);
  const types = new Map(detectable.map((d) => [deviceTypeKey(d), d]));
  facit.devices.forEach((device, i) => {
    const type = types.get(device.type);
    if (!type) problems.push(`device ${i + 1}: unknown type ${device.type}`);
    else if ((device.wall === 'ceiling') !== (type.placement === 'ceiling'))
      problems.push(`device ${i + 1}: ${device.type} goes on the ${type.placement}`);
    if (device.wall !== 'ceiling' && !walls.has(device.wall))
      problems.push(`device ${i + 1}: wall ${device.wall} does not border the room`);
  });
  return problems;
}
