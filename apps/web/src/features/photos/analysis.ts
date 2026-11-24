import {
  earlierPhotos,
  pendingOnFloor,
  photoContext,
  photoPass,
  PhotoOutput,
  type PhotoDetectableInput,
} from '@el-karta/ai-passes';
import type { FloorRecord, Id, SuggestionDraft } from '@el-karta/core';
import type { Attachment } from '@el-karta/data-supabase';
import type { QueryClient } from '@tanstack/react-query';
import { parsePayload } from '@/features/suggestions/ghosts';
import { suggestionKinds } from '@/features/suggestions/actions';
import type { SuggestionSource } from '@/features/suggestions/source';
import {
  abortable,
  passOutput,
  passSource,
  runIssues,
  aiPassFailureCode,
  type AiPassBackend,
  type AiPassFailureCode,
} from '@/lib/ai-pass';
import { photoRunInput, type PhotoImage } from './request';

export interface AnalysisDeps {
  backend: AiPassBackend;
  /** Lists the floor's suggestions, for what is already pending. */
  source: SuggestionSource;
  queries: QueryClient;
  /** The device types photos can show, from the plugins (`photoDetectables`). */
  detectable: readonly PhotoDetectableInput[];
  /** A stored photo's file. */
  loadPhoto: (photoId: Id) => Promise<Blob>;
  toImage: (blob: Blob) => PhotoImage;
  newId: () => Id;
}

export type AnalysisStep = 'preparing' | 'reading' | 'saving';

/** Why an analysis stopped, by its message `photos.analysis.errors.<code>`. */
export type AnalysisErrorCode =
  | AiPassFailureCode
  /** The photo's room is gone or has no walls. */
  | 'no_room'
  /** The photo's file could not be loaded. */
  | 'image';

export class AnalysisError extends Error {
  override name = 'AnalysisError';
  constructor(readonly code: AnalysisErrorCode) {
    super(`Photo analysis failed: ${code}`);
  }
}

/** The message for any error an analysis can end with. */
export const analysisErrorCode = (error: unknown): AnalysisErrorCode =>
  error instanceof AnalysisError ? error.code : aiPassFailureCode(error);

type Floor = Pick<FloorRecord, 'id' | 'projectId' | 'data'>;

const PASS = photoPass.id;

/**
 * Reads one photo through the `ai-pass` function and stores what it finds as pending suggestions
 * (M11 decisions 5–7): the room as context with up to three earlier photos of it, then the
 * suggestions the pass makes, de-duplicated against the room's devices and the floor's pending
 * suggestions. `file` is the photo's file when the caller has it (right after the upload).
 * Returns how many suggestions were stored.
 */
export async function analysePhoto(
  floor: Floor,
  photo: Pick<Attachment, 'id' | 'region'>,
  photos: readonly Attachment[],
  file: Blob | null,
  deps: AnalysisDeps,
  signal: AbortSignal,
  onStep: (step: AnalysisStep) => void,
): Promise<number> {
  onStep('preparing');
  const context = photo.region && photoContext(floor.data, photo.region, deps.detectable);
  if (!context) throw new AnalysisError('no_room');
  const main = file ?? (await deps.loadPhoto(photo.id).catch(() => null));
  if (!main) throw new AnalysisError('image');
  const earlier = (
    await Promise.all(
      earlierPhotos(photos, photo).map((p) => deps.loadPhoto(p.id).catch(() => null)),
    )
  ).filter((blob) => blob !== null);
  const input = await photoRunInput(context, deps.toImage(main), earlier.map(deps.toImage));
  signal.throwIfAborted();

  onStep('reading');
  const ids = { projectId: floor.projectId, floorId: floor.id };
  const response = await abortable(deps.backend.run({ ...ids, pass: PASS, input }, signal), signal);
  const output = passOutput(response, PhotoOutput);

  onStep('saving');
  const suggestions = await deps.source.list(floor.id);
  const pending = pendingOnFloor(suggestions, (s) => parsePayload(suggestionKinds, s));
  const issues = runIssues(response);
  const drafts = photoPass
    .toSuggestions(output, { ...context, photoId: photo.id, ...pending }, deps.newId)
    .map((d): SuggestionDraft =>
      issues.length > 0 ? { ...d, issues: [...d.issues, ...issues] } : d,
    );
  signal.throwIfAborted();
  if (drafts.length === 0) return 0;
  await deps.backend.commit({
    ...ids,
    pass: PASS,
    runIds: [response.runId],
    source: passSource(PASS, [response.model]),
    suggestions: drafts,
  });
  await deps.queries.invalidateQueries({ queryKey: ['suggestions'] });
  return drafts.length;
}
