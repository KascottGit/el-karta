import type { AiPass, Tile } from '../pass.ts';
import { NORM } from '../image.ts';
import { interpretFloorplan, type FloorplanSuggestOptions } from './interpret.ts';
import { mergeFloorplanTiles } from './merge.ts';
import {
  FLOORPLAN_SYSTEM,
  FLOORPLAN_TEXT,
  LOCATE_SYSTEM,
  LOCATE_TEXT,
  TILE_NOTE,
} from './prompt.ts';
import { FloorplanInput, FloorplanOutput, LocateInput, LocateOutput } from './schema.ts';
import { validateFloorplan, validateLocate } from './validate.ts';

/** Margin around the located plan, as a fraction of its longer side, so edge walls stay whole. */
export const CROP_MARGIN = 0.04;

/**
 * The part of a `width` × `height` image to send to the detail call: the located plan with a
 * margin, in whole pixels inside the image; the whole image when no plan was located.
 */
export function planCropBox(
  output: Pick<LocateOutput, 'found' | 'box'>,
  size: { width: number; height: number },
  margin = CROP_MARGIN,
): Tile {
  const whole = { x: 0, y: 0, width: size.width, height: size.height };
  const box = output.box;
  if (!output.found || !box || box.xmax <= box.xmin || box.ymax <= box.ymin) return whole;
  const xmin = (box.xmin / NORM) * size.width;
  const xmax = (box.xmax / NORM) * size.width;
  const ymin = (box.ymin / NORM) * size.height;
  const ymax = (box.ymax / NORM) * size.height;
  const pad = Math.max(xmax - xmin, ymax - ymin) * margin;
  const x = Math.max(0, Math.floor(xmin - pad));
  const y = Math.max(0, Math.floor(ymin - pad));
  const right = Math.min(size.width, Math.ceil(xmax + pad));
  const bottom = Math.min(size.height, Math.ceil(ymax + pad));
  return { x, y, width: right - x, height: bottom - y };
}

/** Finds the main plan on the page so the browser can crop away legends, site maps and sections. */
export const floorplanLocatePass: AiPass<LocateInput, LocateOutput, void> = {
  id: 'floorplan-locate',
  inputSchema: LocateInput,
  outputSchema: LocateOutput,
  prompt: (input) => ({ system: LOCATE_SYSTEM, text: LOCATE_TEXT, images: [input.image] }),
  validate: (output) => validateLocate(output),
  toSuggestions: () => [],
};

/** Reads walls, openings, rooms and scale evidence off a cropped plan or one tile of it. */
export const floorplanPass: AiPass<FloorplanInput, FloorplanOutput, FloorplanSuggestOptions> = {
  id: 'floorplan',
  inputSchema: FloorplanInput,
  outputSchema: FloorplanOutput,
  prompt: (input) => ({
    system: FLOORPLAN_SYSTEM,
    text: input.tile ? `${TILE_NOTE}\n\n${FLOORPLAN_TEXT}` : FLOORPLAN_TEXT,
    images: [input.image],
  }),
  validate: (output) => validateFloorplan(output),
  merge: mergeFloorplanTiles,
  toSuggestions: (output, options, newId) => interpretFloorplan(output, options, newId).drafts,
};
