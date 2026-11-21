import type { AiProvider } from '@el-karta/ai-providers';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { appendCsv, type CsvValue } from '../csv.ts';
import { Facit, Manifest, metresPerImageWidth, type ManifestPlan } from './facit.ts';
import { loadPlanImage } from './image.ts';
import { runFloorplanPipeline, type PlanImage } from './pipeline.ts';
import { readingFromDrafts, scoreFloorplan, type EvalMode } from './score.ts';

const here = import.meta.dirname;

export const FLOORPLAN_COLUMNS = [
  'date',
  'plan',
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

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;

/** The plan files, after checking every one against its manifest checksum. */
async function checkedPlans(
  manifest: Manifest,
  imagesDir: string,
  ids: readonly string[] | undefined,
): Promise<{ plan: ManifestPlan; path: string }[]> {
  const unknown = ids?.filter((id) => !manifest.plans.some((p) => p.id === id)) ?? [];
  if (unknown.length > 0) throw new Error(`Unknown plans: ${unknown.join(', ')}`);
  const plans = ids ? manifest.plans.filter((p) => ids.includes(p.id)) : manifest.plans;
  const problems: string[] = [];
  const checked = await Promise.all(
    plans.map(async (plan) => {
      const path = join(imagesDir, plan.file);
      const data = await readFile(path).catch(() => null);
      if (data === null) problems.push(`${plan.id}: ${path} is missing`);
      else if (sha256(data) !== plan.sha256)
        problems.push(`${plan.id}: ${path} does not match its sha256 in the manifest`);
      return { plan, path };
    }),
  );
  if (problems.length > 0) throw new Error(`Refusing to run:\n${problems.join('\n')}`);
  return checked;
}

const fileSafe = (text: string) => text.replace(/[^a-zA-Z0-9.-]+/g, '_');

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
      ? scoreFloorplan(facit, readingFromDrafts(interpretation.drafts, found), options.mode)
      : null;

    const row: FloorplanRow = {
      date: date.toISOString(),
      plan: plan.id,
      model: options.model,
      modelVersion: result.modelVersion,
      mode: options.mode,
      status: result.status,
      scaleStatus: scale?.status,
      roomsExpected: facit.rooms.length,
      doorsExpected: facit.doors,
      ...scores,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      calls: result.calls,
      durationMs,
      error: result.error,
    };
    rows.push(row);
    await appendCsv(join(resultsDir, 'floorplan.csv'), FLOORPLAN_COLUMNS, [row]);

    const rawDir = join(resultsDir, 'raw');
    await mkdir(rawDir, { recursive: true });
    const stamp = date.toISOString().replace(/[:.]/g, '-');
    const rawPath = join(
      rawDir,
      `${stamp}-${plan.id}-${fileSafe(options.model)}-${options.mode}.json`,
    );
    await writeFile(
      rawPath,
      JSON.stringify(
        {
          plan: plan.id,
          image: { width: image.width, height: image.height, pdfPageWidthMm: image.pdfPageWidthMm },
          ...result,
          scores,
          row,
        },
        null,
        2,
      ),
    );
    log(
      `${plan.id}: ${result.status}, rooms ${String(row.roomsFound ?? '-')}/${facit.rooms.length}, scale ${scale?.status ?? '-'}, ${durationMs} ms`,
    );
  }
  return rows;
}
