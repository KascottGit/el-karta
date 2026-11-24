import {
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
  type Suggestion,
  type SuggestionDraft,
  type SuggestionIssue,
} from '@el-karta/core';
import type { AiRunResponse } from '@el-karta/data-supabase';
import type { QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { SuggestionSource } from '@/features/suggestions/source';
import type { ProjectJson } from '../background/project-json';
import { withoutAccepted, type AcceptedItem } from './dedupe';
import {
  abortable,
  AiPassFailure,
  passOutput,
  passSource,
  runIssues,
  type AiPassBackend,
} from '@/lib/ai-pass';
import { ImportError } from './errors';
import { loadReading, saveReading, type PlanReading, type StoredReading } from './reading';

export interface ImportDeps {
  backend: AiPassBackend;
  /** Where readings are kept between visits. */
  files: ProjectJson;
  /** Lists the floor's suggestions and rejects replaced ones. */
  source: SuggestionSource;
  queries: QueryClient;
  newId: () => Id;
}

type Floor = Pick<FloorRecord, 'id' | 'projectId' | 'data'>;

const PASS = floorplanPass.id;

/** Provenance source of imported items (`passSource`). */
export const importSource = (models: readonly string[]) => passSource(PASS, models);

function outputOf<T>(response: AiRunResponse, schema: z.ZodType<T>): T {
  try {
    return passOutput(response, schema);
  } catch (error) {
    throw error instanceof AiPassFailure ? new ImportError(error.code) : error;
  }
}

/**
 * Reads the floor's plan image through the `ai-pass` function: locate, crop, tile, read, merge
 * (`readFloorplan`). Nothing is stored; `signal` stops it between and during calls. Issues left
 * after a run's retry (`invalid` runs) are kept with the reading, to be shown with its suggestions.
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
  const models: string[] = [];
  const issues = new Map<string, SuggestionIssue>();
  const call = async (pass: string, input: unknown) => {
    const response = await abortable(deps.backend.run({ ...ids, pass, input }, signal), signal);
    for (const issue of runIssues(response)) issues.set(JSON.stringify(issue), issue);
    return response;
  };
  const reading = await readFloorplan(
    image,
    {
      locate: async (input) => outputOf(await call(floorplanLocatePass.id, input), LocateOutput),
      floorplan: async (input) => {
        const response = await call(PASS, input);
        runIds.push(response.runId);
        models.push(response.model);
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
    ...(reading.page ? { page: reading.page } : {}),
    runIds,
    source: importSource(models),
    issues: [...issues.values()],
  };
}

export interface Interpreted {
  interpretation: FloorplanInterpretation;
  /** The placement the drafts are measured at: the floor's, at the chosen scale. */
  placement: BackgroundPlacement;
}

/**
 * M4 decisions 1 and 2 for this floor: its placement, its scale (a user scale is kept) and height.
 * The reading's own issues concern it as a whole, so they go where the interpretation's overall
 * issues go: on the scale suggestion, or on every suggestion when there is none.
 */
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
      page: reading.page,
      allowEstimate,
    },
    newId,
  );
  if (reading.issues.length > 0) {
    const hasScale = interpretation.drafts.some((d) => d.kind === 'scale');
    interpretation.issues = [...interpretation.issues, ...reading.issues];
    interpretation.drafts = interpretation.drafts.map((d) =>
      !hasScale || d.kind === 'scale' ? { ...d, issues: [...d.issues, ...reading.issues] } : d,
    );
  }
  return {
    interpretation,
    placement: {
      ...placement,
      metresPerPixel: interpretation.scale.scale?.metresPerPixel ?? placement.metresPerPixel,
    },
  };
}

/**
 * Stores `drafts` as the floor's pending suggestions from `reading`, replacing the pending ones
 * listed by the reading stored before (a new import, or a new scale). Drafts that repeat a
 * suggestion accepted from an earlier reading of the same image are left out (`withoutAccepted`).
 *
 * The stored reading lists the suggestions committed on the floor that may still matter, each with
 * the placement it was measured at. It is written first, with the new drafts and the old pending
 * ones together, so if committing or rejecting fails the next replacement still finds the old
 * pending suggestions and rejects them. Returns how many suggestions were stored.
 */
export async function commitDrafts(
  floor: Floor,
  reading: PlanReading,
  drafts: readonly SuggestionDraft[],
  placement: BackgroundPlacement,
  deps: ImportDeps,
): Promise<number> {
  const previous = await loadReading(deps.files, floor.projectId, floor.id);
  const rows = new Map<Id, Suggestion>(
    previous ? (await deps.source.list(floor.id)).map((s) => [s.id, s]) : [],
  );
  const sameImage = previous?.attachmentId === reading.attachmentId;
  // Accepted items of another image would be compared at the wrong place, and rejected ones never
  // matter again; pending ones are kept until they have been rejected.
  const carried = (previous?.suggestions ?? []).filter((entry) => {
    const status = rows.get(entry.id)?.status;
    return status === 'pending' || (sameImage && status === 'accepted');
  });
  const stale = carried.filter((e) => rows.get(e.id)?.status === 'pending').map((e) => e.id);
  const accepted = carried.flatMap((e): AcceptedItem[] => {
    const suggestion = rows.get(e.id)!;
    return suggestion.status === 'accepted' ? [{ suggestion, placement: e.placement }] : [];
  });
  const fresh = withoutAccepted(drafts, accepted, placement);
  if (fresh.length === 0 && stale.length === 0) throw new ImportError('empty');

  const stored: StoredReading = {
    ...reading,
    suggestions: [...carried, ...fresh.map((d) => ({ id: d.id, placement }))],
  };
  await saveReading(deps.files, floor.projectId, floor.id, stored);
  if (fresh.length > 0)
    await deps.backend.commit({
      pass: PASS,
      projectId: floor.projectId,
      floorId: floor.id,
      runIds: reading.runIds,
      source: reading.source,
      suggestions: fresh,
    });
  if (stale.length > 0) await deps.source.setStatus(stale, 'rejected');
  await deps.queries.invalidateQueries({ queryKey: ['suggestions'] });
  return fresh.length;
}

const samePlacement = (p: BackgroundPlacement, q: BackgroundPlacement) =>
  Math.abs(p.metresPerPixel / q.metresPerPixel - 1) < 1e-9 &&
  Math.abs(p.rotation - q.rotation) < 1e-9 &&
  Math.abs(p.offset.x - q.offset.x) < 1e-9 &&
  Math.abs(p.offset.y - q.offset.y) < 1e-9;

/**
 * After the floor's scale was set, interprets its stored reading again at that scale and replaces
 * its pending suggestions, so accepting one can never put back the old scale or leave an item at
 * the wrong size (M4 T5, stale suggestions). `onWork` is called once it is clear there is
 * something to replace. Returns how many suggestions replace the pending ones, or null when none
 * is pending at another placement.
 */
export async function reinterpretStored(
  floor: Floor,
  deps: ImportDeps,
  onWork: () => void = () => {},
): Promise<number | null> {
  const stored = await loadReading(deps.files, floor.projectId, floor.id);
  const now = backgroundPlacement(floor.data.background, floor.data.scale);
  if (!stored || !now || stored.attachmentId !== floor.data.background?.attachmentId) return null;
  const status = new Map((await deps.source.list(floor.id)).map((s) => [s.id, s.status]));
  const pending = stored.suggestions.filter((e) => status.get(e.id) === 'pending');
  if (pending.every((e) => samePlacement(e.placement, now))) return null;
  onWork();
  const { interpretation, placement } = interpretReading(stored, floor.data, false, deps.newId);
  return commitDrafts(floor, stored, interpretation.drafts, placement, deps);
}
