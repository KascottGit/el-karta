import { FloorplanOutput, PageEvidence, TileSchema } from '@el-karta/ai-passes';
import { Id, Pt, SuggestionIssue } from '@el-karta/core';
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
  /**
   * What the locate call read anywhere on the page, such as a scale in the legend outside the
   * crop, in pixels of the full image; absent in readings stored before it was kept.
   */
  page: PageEvidence.optional(),
  /** The `floorplan` runs it came from. */
  runIds: z.array(Id),
  /** Provenance source of its suggestions, `ai:floorplan:<model>[+<model>…]` (`importSource`). */
  source: z.string(),
  /** Issues left after a run's retry (`invalid` runs), shown with the suggestions. */
  issues: z.array(SuggestionIssue).default([]),
});
export type PlanReading = z.infer<typeof PlanReading>;

export const Placement = z.object({
  offset: Pt,
  rotation: z.number(),
  metresPerPixel: z.number().positive(),
});

/**
 * The latest reading of a floor's plan, with every suggestion committed from it or from earlier
 * readings of the same floor, each with the background placement (and so the scale) it was
 * measured at. Stored per floor in Storage, so a scale set later, also after a reload or by another
 * member, re-interprets it; and so a suggestion left pending by a failed replacement is still
 * known, and rejected, next time.
 */
export const StoredReading = PlanReading.extend({
  suggestions: z.array(z.object({ id: Id, placement: Placement })),
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
