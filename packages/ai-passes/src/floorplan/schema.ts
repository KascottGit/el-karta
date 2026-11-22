import type { ImageInput } from '@el-karta/ai-providers';
import { RoomType } from '@el-karta/core';
import { z } from 'zod';
import type { Tile } from '../pass.ts';

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

/** A rectangle of the full background image, in its pixels (the ones `BackgroundPlacement` uses). */
export const TileSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
}) satisfies z.ZodType<Tile>;

export const LocateInput = z.object({ image: ImageInputSchema });
export type LocateInput = z.infer<typeof LocateInput>;

export const FloorplanInput = z.object({
  image: ImageInputSchema,
  /** Where the sent image lies in the full background image. */
  frame: TileSchema,
  /** True when the image is one tile of a larger plan, so walls may continue past its edges. */
  tile: z.boolean(),
});
export type FloorplanInput = z.infer<typeof FloorplanInput>;

export const LengthUnit = z.enum(['mm', 'cm', 'm']);
export type LengthUnit = z.infer<typeof LengthUnit>;

/** Objects with a standard real size; their sizes live in `scale.ts`, not in the prompt. */
export const StandardObjectType = z.enum([
  'interior_door_leaf',
  'entrance_door',
  'wardrobe',
  'kitchen_counter_depth',
  'single_bed',
  'double_bed',
  'toilet',
  'bathtub',
]);
export type StandardObjectType = z.infer<typeof StandardObjectType>;

export const PaperSize = z.enum(['A0', 'A1', 'A2', 'A3', 'A4', 'A5']);
export type PaperSize = z.infer<typeof PaperSize>;

export const DetectedWall = z.object({
  a: NormPoint,
  b: NormPoint,
  exterior: z.boolean(),
  /** Drawn thickness in the same units as x (thousandths of the image width). */
  thickness: z.number().nullable(),
});
export type DetectedWall = z.infer<typeof DetectedWall>;

export const DetectedOpening = z.object({
  kind: z.enum(['door', 'window', 'passage']),
  /** The two jambs, i.e. the ends of the gap in the wall. */
  a: NormPoint,
  b: NormPoint,
  /** Two leaves in one opening, such as double balcony doors. */
  double: z.boolean(),
  /** The jamb the door leaf turns about, if visible. */
  hinge: z.enum(['a', 'b']).nullable(),
  /** A point inside the door's swing arc, i.e. on the side it opens towards, if visible. */
  swingInto: NormPoint.nullable(),
});
export type DetectedOpening = z.infer<typeof DetectedOpening>;

export const DetectedRoom = z.object({
  /** As printed, e.g. "WC/D" or "Hall/Kokvrå". */
  name: z.string(),
  type: RoomType,
  /** Centre of the printed label, which lies inside the room. */
  point: NormPoint,
  /** Rough extent of the room. */
  box: NormBox.nullable(),
  /** Printed area in m², if any. */
  area: z.number().nullable(),
  /** Balconies, terraces and patios, which a printed total area leaves out. */
  outdoor: z.boolean(),
});
export type DetectedRoom = z.infer<typeof DetectedRoom>;

export const DetectedDimension = z.object({
  value: z.number(),
  unit: LengthUnit,
  /** The two ends the dimension measures. */
  a: NormPoint,
  b: NormPoint,
});
export type DetectedDimension = z.infer<typeof DetectedDimension>;

export const DetectedScaleBar = z.object({
  unit: LengthUnit,
  ticks: z.array(z.object({ value: z.number(), point: NormPoint })),
});
export type DetectedScaleBar = z.infer<typeof DetectedScaleBar>;

/**
 * Scale and size evidence printed once per page. Estate agents often print it in the legend or
 * title block outside the plan, which the detail call's crop leaves out, so the locate call reports
 * it too, from the whole page. `readFloorplan` returns the locate call's evidence in full-image
 * pixels (`page`), and `interpretFloorplan` fills each field the detail call left null from it.
 */
export const PageEvidence = z.object({
  scaleBar: DetectedScaleBar.nullable(),
  /** A printed ratio such as "1:100". */
  scaleText: z.string().nullable(),
  paperSize: PaperSize.nullable(),
  /** Printed total area in m², e.g. from "Area ca 23 m²". */
  totalArea: z.number().nullable(),
  /** Printed ceiling height in metres. */
  ceilingHeight: z.number().nullable(),
});
export type PageEvidence = z.infer<typeof PageEvidence>;

/** What the locate call reports, normalised to the whole page (the image it is sent). */
export const LocateOutput = z.object({
  /** False when the image holds no floor plan at all. */
  found: z.boolean(),
  /** The main floor plan only, without legend, site map, section or title block. */
  box: NormBox.nullable(),
  ...PageEvidence.shape,
});
export type LocateOutput = z.infer<typeof LocateOutput>;

export const DetectedStandardObject = z.object({
  type: StandardObjectType,
  /** The two ends of the measured dimension (see the prompt for which one per type). */
  a: NormPoint,
  b: NormPoint,
});
export type DetectedStandardObject = z.infer<typeof DetectedStandardObject>;

/** What the detail call reports, all in normalised coordinates of the sent image. */
export const FloorplanOutput = z.object({
  walls: z.array(DetectedWall),
  openings: z.array(DetectedOpening),
  rooms: z.array(DetectedRoom),
  dimensions: z.array(DetectedDimension),
  ...PageEvidence.shape,
  standardObjects: z.array(DetectedStandardObject),
});
export type FloorplanOutput = z.infer<typeof FloorplanOutput>;
