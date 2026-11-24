import { Id, Opening, Placement, Pt, Room } from '@el-karta/core';
import { z } from 'zod';
import { ImageInputSchema, NormBox, NormPoint } from '../image.ts';

/**
 * One device type the pass may report: core `PhotoDetectable`, built by the app from the plugins'
 * `aiHints` with `photoDetectables(registry)`, so a new domain is detected without changing the pass.
 */
export const PhotoDetectableSchema = z.object({
  domain: z.string().min(1),
  type: z.string().min(1),
  description: z.string(),
  placement: z.enum(['wall', 'ceiling']),
  defaultHeight: z.number().positive().optional(),
  visibleProps: z.record(z.string(), z.array(z.string())).optional(),
  countable: z.boolean().optional(),
  ports: z.array(z.object({ kind: z.string().min(1), domain: z.string().min(1) })),
});
export type PhotoDetectableInput = z.infer<typeof PhotoDetectableSchema>;

/** `<domain>.<type>`, how the prompt and the output name a device type (domains may share type names). */
export const deviceTypeKey = (d: { domain: string; type: string }) => `${d.domain}.${d.type}`;

/** A wall of the room, with the face that looks into the room (`WallPlacement.side`). */
export const PhotoWall = z.object({
  id: Id,
  a: Pt,
  b: Pt,
  thickness: z.number().positive(),
  side: z.enum(['left', 'right']),
});
export type PhotoWall = z.infer<typeof PhotoWall>;

/**
 * Everything the pass gets (M11 decision 7). In the prompt and the output, walls are named by
 * letter in `walls` order (A is the first), openings `O1`, `O2`, … and existing devices `E1`, `E2`,
 * … in their array order.
 */
export const PhotoInput = z.object({
  image: ImageInputSchema,
  /** 0–3 earlier photos of the same room, for context only; nothing is read off them. */
  earlier: z.array(ImageInputSchema).max(3),
  room: Room.pick({ id: true, name: true, type: true, polygon: true }).extend({
    /** The room's own ceiling height, else the floor's height. */
    ceilingHeight: z.number().positive(),
  }),
  /** The room's walls, clockwise as seen from above. */
  walls: z.array(PhotoWall).min(1).max(26),
  /** The wall the person said the photo shows; null when they chose the room only. */
  targetWallId: Id.nullable(),
  openings: z.array(
    Opening.pick({
      id: true,
      wallId: true,
      kind: true,
      offset: true,
      width: true,
      height: true,
      sill: true,
    }),
  ),
  /** Devices already in the room, so the model can say a feature is one of them. */
  devices: z.array(
    z.object({ id: Id, domain: z.string(), type: z.string(), placement: Placement }),
  ),
  detectable: z.array(PhotoDetectableSchema).min(1),
});
export type PhotoInput = z.infer<typeof PhotoInput>;

export const ImageCorner = z.enum(['top_left', 'top_right', 'bottom_left', 'bottom_right']);
export type ImageCorner = z.infer<typeof ImageCorner>;

/**
 * An image point of something whose place on the wall is known. Corners are as seen in the photo:
 * for a wall, top is where it meets the ceiling and bottom where it meets the floor, left and right
 * its two ends; for an opening, the corners of its frame.
 */
export const PhotoReference = z.object({
  what: z.enum(['wall_corner', 'opening_corner']),
  /** A wall letter for `wall_corner`, an opening (`O1`, …) for `opening_corner`. */
  ref: z.string(),
  corner: ImageCorner,
  point: NormPoint,
});
export type PhotoReference = z.infer<typeof PhotoReference>;

export const PhotoFeature = z.object({
  /** A `deviceTypeKey` from the input's `detectable`. */
  deviceType: z.string(),
  /** A wall letter, or `ceiling`. */
  wall: z.string(),
  box: NormBox,
  /** Units side by side in one frame (a double outlet is 2), for countable types. */
  count: z.int().nullable(),
  /** Props read off the photo, only from the type's `visibleProps`. */
  props: z.array(z.object({ name: z.string(), value: z.string() })),
  confidence: z.number().min(0).max(1),
  /** The existing device (`E1`, …) this is, if it is one already in the model. */
  existing: z.string().nullable(),
});
export type PhotoFeature = z.infer<typeof PhotoFeature>;

/** What the model reports, in normalised coordinates of the photo (`image`). */
export const PhotoOutput = z.object({
  /** The letter of the wall the photo mainly shows, or null if it shows none clearly. */
  wall: z.string().nullable(),
  references: z.array(PhotoReference),
  features: z.array(PhotoFeature),
});
export type PhotoOutput = z.infer<typeof PhotoOutput>;
