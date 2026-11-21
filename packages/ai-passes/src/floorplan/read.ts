import type { ImageInput } from '@el-karta/ai-providers';
import type { Tile } from '../pass.ts';
import { tilesBounds } from './frame.ts';
import { mergeFloorplanTiles } from './merge.ts';
import { planCropBox } from './passes.ts';
import type { FloorplanInput, FloorplanOutput, LocateInput, LocateOutput } from './schema.ts';
import { planTiles } from './tiles.ts';

/** A plan page as the app holds it: the full background image, and parts of it encoded on demand. */
export interface PlanImage {
  width: number;
  height: number;
  /** Width of the PDF page in millimetres, when the image is a rendered PDF page. */
  pdfPageWidthMm?: number | undefined;
  /** The `region` of the image (in its pixels) as an image to send. */
  encode(region: Tile): Promise<ImageInput>;
}

/**
 * Runs the two passes, wherever they run (locally in evals, through the `ai-pass` function in the
 * app). Each returns the parsed output, or null when the call gave nothing usable.
 */
export interface FloorplanCalls {
  locate(input: LocateInput, frame: Tile): Promise<LocateOutput | null>;
  floorplan(input: FloorplanInput): Promise<FloorplanOutput | null>;
}

export type ReadProgress =
  | { step: 'locate' }
  /** About to read tile `index` (from 0) of `count`. */
  | { step: 'tile'; index: number; count: number };

export interface FloorplanReading {
  /** The located plan with its margin, in pixels of the full image; null if locating failed. */
  crop: Tile | null;
  /** The tiles of the crop, in pixels of the full image. */
  tiles: Tile[];
  /** The joined output, in coordinates normalised to `frame`; null if any call failed. */
  output: FloorplanOutput | null;
  frame: Tile | null;
}

/**
 * M4 decisions 1 and 6: locate the plan on the whole page, crop to it with a margin, tile the crop
 * when it is large, read each tile and merge. Stops at the first call that returns nothing.
 */
export async function readFloorplan(
  image: PlanImage,
  calls: FloorplanCalls,
  onProgress: (progress: ReadProgress) => void = () => {},
): Promise<FloorplanReading> {
  const size = { width: image.width, height: image.height };
  const reading: FloorplanReading = { crop: null, tiles: [], output: null, frame: null };
  const whole: Tile = { x: 0, y: 0, ...size };
  onProgress({ step: 'locate' });
  const located = await calls.locate({ image: await image.encode(whole) }, whole);
  if (!located) return reading;

  const crop = planCropBox(located, size);
  reading.crop = crop;
  reading.tiles = planTiles(crop.width, crop.height).map((t) => ({
    ...t,
    x: t.x + crop.x,
    y: t.y + crop.y,
  }));
  const parts: { tile: Tile; output: FloorplanOutput }[] = [];
  for (const [index, tile] of reading.tiles.entries()) {
    onProgress({ step: 'tile', index, count: reading.tiles.length });
    const output = await calls.floorplan({
      image: await image.encode(tile),
      frame: tile,
      tile: reading.tiles.length > 1,
    });
    if (!output) return reading;
    parts.push({ tile, output });
  }
  reading.output = parts.length === 1 ? parts[0]!.output : mergeFloorplanTiles(parts);
  reading.frame = tilesBounds(reading.tiles);
  return reading;
}
