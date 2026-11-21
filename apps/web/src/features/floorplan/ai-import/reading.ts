import { FloorplanOutput, TileSchema } from '@el-karta/ai-passes';
import { Id, Pt } from '@el-karta/core';
import { z } from 'zod';
import type { ProjectJson } from '../background/project-json';

/** What the model read off a floor's plan image: everything needed to interpret it again. */
export const PlanReading = z.object({
  /** The background image it was read from; a reading of another image is never re-used. */
  attachmentId: Id,
  /** The merged model output, normalised to `frame`. */
  output: FloorplanOutput,
  frame: TileSchema,
  imageSize: z.object({ width: z.number().positive(), height: z.number().positive() }),
  pdfPageWidthMm: z.number().positive().optional(),
  /** The `floorplan` runs it came from. */
  runIds: z.array(Id),
  /** Provenance source of its suggestions, `ai:floorplan:<model>`. */
  source: z.string(),
});
export type PlanReading = z.infer<typeof PlanReading>;

/**
 * A reading with the suggestions last committed from it and the background placement (with the
 * scale) they were measured at. Stored per floor in Storage, so a scale set later, also after a
 * reload or by another member, re-interprets it instead of leaving suggestions at the old scale.
 */
export const StoredReading = PlanReading.extend({
  suggestionIds: z.array(Id),
  placement: z.object({
    offset: Pt,
    rotation: z.number(),
    metresPerPixel: z.number().positive(),
  }),
});
export type StoredReading = z.infer<typeof StoredReading>;

const name = (floorId: Id) => `ai-import/${floorId}`;

export const saveReading = (
  files: ProjectJson,
  projectId: Id,
  floorId: Id,
  reading: StoredReading,
) => files.save(projectId, name(floorId), reading);

export const loadReading = (files: ProjectJson, projectId: Id, floorId: Id) =>
  files.load(projectId, name(floorId), StoredReading);
