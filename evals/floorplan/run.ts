import type { ModelChoice } from '@el-karta/ai-passes';
import type { AiProvider } from '@el-karta/ai-providers';
import { DEFAULT_METRES_PER_PIXEL } from '@el-karta/core';
import { dirname, join, resolve } from 'node:path';
import { checkFiles, passChoice, readJson, writeRaw } from '../common.ts';
import { appendCsv, type CsvValue } from '../csv.ts';
import { Facit, Manifest, metresPerImageWidth, type ManifestPlan } from './facit.ts';
import { loadPlanImage } from './image.ts';
import { runFloorplanPipeline, type PlanImage } from './pipeline.ts';
import { failedRunScores, readingFromDrafts, scoreFloorplan, type EvalMode } from './score.ts';

const here = import.meta.dirname;

export const FLOORPLAN_COLUMNS = [
  'date',
  'plan',
  'provider',
  'model',
  'modelVersion',
  'mode',
  'status',
  'scaleStatus',
  'roomsExpected',
  'roomsFound',
  'nameMatch',
  'typeAccuracy',
  'doorsExpected',
  'doorsFound',
  'scaleError',
  'estimateWithin10',
  'rotationErrorDeg',
  'roomAreaError',
  'wallLengthError',
  'inputTokens',
  'outputTokens',
  'costUsd',
  'calls',
  'durationMs',
  'error',
] as const;
export type FloorplanRow = Partial<Record<(typeof FLOORPLAN_COLUMNS)[number], CsvValue>>;

export interface FloorplanEvalOptions {
  provider: AiProvider;
  model: string;
  mode: EvalMode;
  /** Plan ids to run; all plans in the manifest when left out. */
  plans?: readonly string[] | undefined;
  manifestPath?: string;
  /** Overrides the manifest's `imagesDir`, e.g. when running from a git worktree. */
  imagesDir?: string | undefined;
  facitDir?: string;
  resultsDir?: string;
  now?: () => Date;
  loadImage?: (path: string, page: number) => Promise<PlanImage>;
  log?: (line: string) => void;
}

/** The provider and model to evaluate: as given, else the floor-plan pass's default on it. */
export const floorplanEvalChoice = (
  provider: string | undefined,
  model: string | undefined,
): ModelChoice => passChoice('floorplan', provider, model);

/** The plan files, after checking every one against its manifest checksum. */
async function checkedPlans(
  manifest: Manifest,
  imagesDir: string,
  ids: readonly string[] | undefined,
): Promise<{ plan: ManifestPlan; path: string }[]> {
  const unknown = ids?.filter((id) => !manifest.plans.some((p) => p.id === id)) ?? [];
  if (unknown.length > 0) throw new Error(`Unknown plans: ${unknown.join(', ')}`);
  const plans = ids ? manifest.plans.filter((p) => ids.includes(p.id)) : manifest.plans;
  const checked = plans.map((plan) => ({ plan, path: join(imagesDir, plan.file) }));
  await checkFiles(checked.map(({ plan, path }) => ({ name: plan.id, path, sha256: plan.sha256 })));
  return checked;
}

/**
 * Runs the floor-plan import flow on each plan, scores it against its facit, appends a row per plan
 * to `results/floorplan.csv` and writes every model output to `results/raw/` for debugging.
 */
export async function runFloorplanEval(options: FloorplanEvalOptions): Promise<FloorplanRow[]> {
  const manifestPath = options.manifestPath ?? join(here, 'manifest.json');
  const facitDir = options.facitDir ?? join(here, 'facit');
  const resultsDir = options.resultsDir ?? resolve(here, '../results');
  const now = options.now ?? (() => new Date());
  const loadImage = options.loadImage ?? loadPlanImage;
  const log = options.log ?? (() => {});

  const manifest = Manifest.parse(await readJson(manifestPath));
  const imagesDir = options.imagesDir ?? resolve(dirname(manifestPath), manifest.imagesDir);
  const plans = await checkedPlans(manifest, imagesDir, options.plans);
  const facits = await Promise.all(
    plans.map(async ({ plan }) => Facit.parse(await readJson(join(facitDir, `${plan.id}.json`)))),
  );

  const rows: FloorplanRow[] = [];
  for (const [index, { plan, path }] of plans.entries()) {
    const facit = facits[index]!;
    const date = now();
    const image = await loadImage(path, plan.page);
    const start = performance.now();
    const result = await runFloorplanPipeline(image, {
      provider: options.provider,
      model: options.model,
      mode: options.mode,
    });
    const durationMs = Math.round(performance.now() - start);
    const interpretation = result.interpretation;
    const scale = interpretation?.scale;
    const found =
      scale?.scale && scale.status !== 'none'
        ? metresPerImageWidth(scale.scale.metresPerPixel, image.width)
        : null;
    const scores = interpretation
      ? scoreFloorplan(
          facit,
          readingFromDrafts(interpretation.drafts, {
            found,
            geometry: found ?? metresPerImageWidth(DEFAULT_METRES_PER_PIXEL, image.width),
          }),
          options.mode,
        )
      : failedRunScores(facit, options.mode);

    const row: FloorplanRow = {
      date: date.toISOString(),
      plan: plan.id,
      provider: options.provider.id,
      model: options.model,
      modelVersion: result.modelVersion,
      mode: options.mode,
      status: result.status,
      scaleStatus: scale?.status,
      ...scores,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: result.costUsd?.toFixed(6),
      calls: result.calls,
      durationMs,
      error: result.error,
    };
    rows.push(row);
    await appendCsv(join(resultsDir, 'floorplan.csv'), FLOORPLAN_COLUMNS, [row]);

    await writeRaw(resultsDir, date, [plan.id, options.model, options.mode], {
      plan: plan.id,
      image: { width: image.width, height: image.height, pdfPageWidthMm: image.pdfPageWidthMm },
      ...result,
      scores,
      row,
    });
    log(
      `${plan.id}: ${result.status}, rooms ${String(row.roomsFound ?? '-')}/${facit.rooms.length}, scale ${scale?.status ?? '-'}, ${durationMs} ms`,
    );
  }
  return rows;
}
