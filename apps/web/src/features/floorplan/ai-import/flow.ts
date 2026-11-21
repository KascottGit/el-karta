import {
  defaultModels,
  floorplanLocatePass,
  floorplanPass,
  FloorplanOutput,
  interpretFloorplan,
  LocateOutput,
  readFloorplan,
  type FloorplanInterpretation,
  type PlanImage,
  type ReadProgress,
} from '@el-karta/ai-passes';
import {
  backgroundPlacement,
  type BackgroundPlacement,
  type FloorData,
  type FloorRecord,
  type Id,
  type SuggestionDraft,
} from '@el-karta/core';
import type { AiRunResponse } from '@el-karta/data-supabase';
import type { QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { SuggestionSource } from '@/features/suggestions/source';
import type { ProjectJson } from '../background/project-json';
import type { AiImportBackend } from './backend';
import { withoutAccepted } from './dedupe';
import { abortable, ImportError } from './errors';
import { loadReading, saveReading, type PlanReading, type StoredReading } from './reading';

export interface ImportDeps {
  backend: AiImportBackend;
  /** Where readings are kept between visits. */
  files: ProjectJson;
  /** Lists the floor's suggestions and rejects replaced ones. */
  source: SuggestionSource;
  queries: QueryClient;
  newId: () => Id;
}

type Floor = Pick<FloorRecord, 'id' | 'projectId' | 'data'>;

const PASS = floorplanPass.id;

/** Provenance source of imported items: the pass and the model it runs by default. */
export const importSource = () => `ai:${PASS}:${defaultModels[PASS] ?? 'unknown'}`;

function outputOf<T>(response: AiRunResponse, schema: z.ZodType<T>): T {
  if (response.status === 'rate_limited') throw new ImportError('provider_busy');
  if (response.status === 'error') throw new ImportError('internal');
  const parsed = schema.safeParse(response.output);
  if (response.output === null || !parsed.success) throw new ImportError('no_output');
  return parsed.data;
}

/**
 * Reads the floor's plan image through the `ai-pass` function: locate, crop, tile, read, merge
 * (`readFloorplan`). Nothing is stored; `signal` stops it between and during calls.
 */
export async function readPlan(
  floor: Floor,
  image: PlanImage,
  deps: Pick<ImportDeps, 'backend'>,
  signal: AbortSignal,
  onProgress: (progress: ReadProgress) => void,
): Promise<PlanReading> {
  const background = floor.data.background;
  if (!background) throw new ImportError('image');
  const ids = { projectId: floor.projectId, floorId: floor.id };
  const runIds: Id[] = [];
  const reading = await readFloorplan(
    image,
    {
      locate: async (input) =>
        outputOf(
          await abortable(
            deps.backend.run({ ...ids, pass: floorplanLocatePass.id, input }),
            signal,
          ),
          LocateOutput,
        ),
      floorplan: async (input) => {
        const response = await abortable(deps.backend.run({ ...ids, pass: PASS, input }), signal);
        runIds.push(response.runId);
        return outputOf(response, FloorplanOutput);
      },
    },
    (progress) => {
      signal.throwIfAborted();
      onProgress(progress);
    },
  );
  if (!reading.output || !reading.frame) throw new ImportError('no_output');
  return {
    attachmentId: background.attachmentId,
    output: reading.output,
    frame: reading.frame,
    imageSize: { width: image.width, height: image.height },
    ...(image.pdfPageWidthMm === undefined ? {} : { pdfPageWidthMm: image.pdfPageWidthMm }),
    runIds,
    source: importSource(),
  };
}

export interface Interpreted {
  interpretation: FloorplanInterpretation;
  /** The placement the drafts are measured at: the floor's, at the chosen scale. */
  placement: BackgroundPlacement;
}

/** M4 decisions 1 and 2 for this floor: its placement, its scale (a user scale is kept) and height. */
export function interpretReading(
  reading: PlanReading,
  data: FloorData,
  allowEstimate: boolean,
  newId: () => Id,
): Interpreted {
  const placement = backgroundPlacement(data.background, data.scale);
  if (!placement) throw new ImportError('image');
  const interpretation = interpretFloorplan(
    reading.output,
    {
      frame: reading.frame,
      imageSize: reading.imageSize,
      placement,
      existingScale: data.scale,
      floorHeight: data.height,
      pdfPageWidthMm: reading.pdfPageWidthMm,
      allowEstimate,
    },
    newId,
  );
  return {
    interpretation,
    placement: {
      ...placement,
      metresPerPixel: interpretation.scale.scale?.metresPerPixel ?? placement.metresPerPixel,
    },
  };
}

/**
 * Stores `drafts` as the floor's pending suggestions from `reading`, replacing the pending ones of
 * the reading stored before (a new import, or a new scale). The reading is saved first, so the
 * suggestions it lists can always be re-interpreted; the old pending rows are rejected last, so a
 * failure never leaves the floor without suggestions. Returns how many were stored.
 */
export async function commitDrafts(
  floor: Floor,
  reading: PlanReading,
  drafts: readonly SuggestionDraft[],
  placement: BackgroundPlacement,
  deps: ImportDeps,
): Promise<number> {
  const previous = await loadReading(deps.files, floor.projectId, floor.id);
  const stale = previous ? await pendingOf(previous, floor.id, deps.source) : [];
  if (drafts.length === 0 && stale.length === 0) throw new ImportError('empty');
  const stored: StoredReading = {
    ...reading,
    suggestionIds: drafts.map((d) => d.id),
    placement,
  };
  await saveReading(deps.files, floor.projectId, floor.id, stored);
  if (drafts.length > 0)
    await deps.backend.commit({
      pass: PASS,
      projectId: floor.projectId,
      floorId: floor.id,
      runIds: reading.runIds,
      source: reading.source,
      suggestions: [...drafts],
    });
  if (stale.length > 0) await deps.source.setStatus(stale, 'rejected');
  await deps.queries.invalidateQueries({ queryKey: ['suggestions'] });
  return drafts.length;
}

async function pendingOf(reading: StoredReading, floorId: Id, source: SuggestionSource) {
  const mine = new Set(reading.suggestionIds);
  return (await source.list(floorId))
    .filter((s) => mine.has(s.id) && s.status === 'pending')
    .map((s) => s.id);
}

const samePlacement = (p: BackgroundPlacement, q: BackgroundPlacement) =>
  Math.abs(p.metresPerPixel / q.metresPerPixel - 1) < 1e-9 &&
  Math.abs(p.rotation - q.rotation) < 1e-9 &&
  Math.abs(p.offset.x - q.offset.x) < 1e-9 &&
  Math.abs(p.offset.y - q.offset.y) < 1e-9;

/**
 * After the floor's scale was set, interprets its stored reading again at that scale and replaces
 * the reading's pending suggestions, so accepting one can never put back the old scale or leave an
 * item at the wrong size (M4 T5, stale suggestions). Drafts repeating an item already accepted from
 * the reading are left out. `onWork` is called once it is clear there is something to replace.
 * Returns how many suggestions replace the pending ones, or null when there was nothing to replace.
 */
export async function reinterpretStored(
  floor: Floor,
  deps: ImportDeps,
  onWork: () => void = () => {},
): Promise<number | null> {
  const stored = await loadReading(deps.files, floor.projectId, floor.id);
  const now = backgroundPlacement(floor.data.background, floor.data.scale);
  if (!stored || !now || stored.attachmentId !== floor.data.background?.attachmentId) return null;
  if (samePlacement(stored.placement, now)) return null;
  const mine = new Set(stored.suggestionIds);
  const suggestions = (await deps.source.list(floor.id)).filter((s) => mine.has(s.id));
  if (!suggestions.some((s) => s.status === 'pending')) return null;
  onWork();
  const { interpretation, placement } = interpretReading(stored, floor.data, false, deps.newId);
  const accepted = suggestions.filter((s) => s.status === 'accepted');
  const drafts = withoutAccepted(interpretation.drafts, accepted, stored.placement, placement);
  return commitDrafts(floor, stored, drafts, placement, deps);
}
