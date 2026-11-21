import {
  floorplanLocatePass,
  floorplanPass,
  interpretFloorplan,
  mergeFloorplanTiles,
  planCropBox,
  planTiles,
  runPass,
  tilesBounds,
  type FloorplanInterpretation,
  type FloorplanOutput,
  type LocateOutput,
  type RunResult,
  type RunStatus,
  type Tile,
} from '@el-karta/ai-passes';
import type { AiProvider, ImageInput, Usage } from '@el-karta/ai-providers';
import { DEFAULT_METRES_PER_PIXEL } from '@el-karta/core';
import type { EvalMode } from './score.ts';

/** A plan page as the app holds it: the full background image, and parts of it encoded on demand. */
export interface PlanImage {
  width: number;
  height: number;
  /** Width of the PDF page in millimetres, when the image is a rendered PDF page. */
  pdfPageWidthMm?: number | undefined;
  /** The `region` of the image (in its pixels) as an image to send. */
  encode(region: Tile): Promise<ImageInput>;
}

export interface PipelineOptions {
  provider: AiProvider;
  model: string;
  mode: EvalMode;
  newId?: () => string;
}

/** Each call's result, without the image, for the raw debugging output. */
export interface PipelineCall<Out> {
  pass: string;
  frame: Tile;
  result: RunResult<Out>;
}

export interface PipelineResult {
  /** The worst status of any call. */
  status: RunStatus;
  error?: string;
  locate: PipelineCall<LocateOutput> | null;
  crop: Tile | null;
  tiles: PipelineCall<FloorplanOutput>[];
  /** The joined output, in coordinates normalised to `frame`, after estimate-mode stripping. */
  output: FloorplanOutput | null;
  frame: Tile | null;
  interpretation: FloorplanInterpretation | null;
  usage: Usage;
  calls: number;
  modelVersion?: string;
}

const STATUS_RANK: readonly RunStatus[] = ['ok', 'invalid', 'rate_limited', 'error'];
const worse = (a: RunStatus, b: RunStatus) =>
  STATUS_RANK.indexOf(a) >= STATUS_RANK.indexOf(b) ? a : b;

/**
 * Removes every piece of printed scale evidence, so the scale chain can only estimate from objects
 * of standard size (M4 decision 9, estimate mode).
 */
export function stripPrintedScale(output: FloorplanOutput): FloorplanOutput {
  return {
    ...output,
    scaleText: null,
    paperSize: null,
    dimensions: [],
    scaleBar: null,
    totalArea: null,
    rooms: output.rooms.map((r) => ({ ...r, area: null })),
  };
}

/**
 * The app's import flow (M4 decisions 1, 2 and 6) without the browser: locate the plan on the whole
 * page, crop to it with a margin, tile the crop when it is large, read each tile, merge, and
 * interpret with the background placed at the plan origin, unturned.
 */
export async function runFloorplanPipeline(
  image: PlanImage,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const { provider, model, mode } = options;
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const size = { width: image.width, height: image.height };
  const result: PipelineResult = {
    status: 'ok',
    locate: null,
    crop: null,
    tiles: [],
    output: null,
    frame: null,
    interpretation: null,
    usage: {},
    calls: 0,
  };
  const record = <Out>(pass: string, frame: Tile, run: RunResult<Out>): PipelineCall<Out> => {
    result.status = worse(result.status, run.status);
    result.calls += 1 + run.validationRetries;
    if (run.usage.inputTokens !== undefined)
      result.usage.inputTokens = (result.usage.inputTokens ?? 0) + run.usage.inputTokens;
    if (run.usage.outputTokens !== undefined)
      result.usage.outputTokens = (result.usage.outputTokens ?? 0) + run.usage.outputTokens;
    if (run.modelVersion !== undefined) result.modelVersion = run.modelVersion;
    if (run.error !== undefined) result.error ??= `${pass}: ${run.error}`;
    return { pass, frame, result: run };
  };

  const whole: Tile = { x: 0, y: 0, ...size };
  const locate = await runPass(
    floorplanLocatePass,
    { image: await image.encode(whole) },
    { provider, model },
  );
  result.locate = record(floorplanLocatePass.id, whole, locate);
  if (!locate.output) return result;

  const crop = planCropBox(locate.output, size);
  result.crop = crop;
  const tiles = planTiles(crop.width, crop.height).map((t) => ({
    ...t,
    x: t.x + crop.x,
    y: t.y + crop.y,
  }));
  for (const tile of tiles) {
    const run = await runPass(
      floorplanPass,
      { image: await image.encode(tile), frame: tile, tile: tiles.length > 1 },
      { provider, model },
    );
    result.tiles.push(record(floorplanPass.id, tile, run));
    if (!run.output) return result;
  }

  const parts = result.tiles.map((t) => ({ tile: t.frame, output: t.result.output! }));
  const merged = parts.length === 1 ? parts[0]!.output : mergeFloorplanTiles(parts);
  const output = mode === 'estimate' ? stripPrintedScale(merged) : merged;
  const frame = tilesBounds(tiles);
  result.output = output;
  result.frame = frame;
  result.interpretation = interpretFloorplan(
    output,
    {
      frame,
      imageSize: size,
      placement: { offset: { x: 0, y: 0 }, rotation: 0, metresPerPixel: DEFAULT_METRES_PER_PIXEL },
      pdfPageWidthMm: mode === 'estimate' ? undefined : image.pdfPageWidthMm,
      allowEstimate: mode === 'estimate',
    },
    newId,
  );
  return result;
}
