import { Id, SuggestionDraft, type Issue } from '@el-karta/core';
import { z } from 'zod';

/**
 * The request and response shapes of the `ai-pass` Edge Function (ADR 0007). The function parses
 * requests with these schemas, and `SuggestionRepository` sends them.
 */
export const AI_PASS_FUNCTION = 'ai-pass';

/** Requests carry the image or tile, so the body is capped (decision 7 in docs/milestones/M4.md). */
export const AI_PASS_MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Runs per user and hour when `AI_RUNS_PER_HOUR` is not set. */
export const DEFAULT_AI_RUNS_PER_HOUR = 30;

/** Runs one pass on one image or tile. `input` is checked against the pass's own input schema. */
export const AiRunRequest = z.object({
  action: z.literal('run'),
  pass: z.string().min(1),
  projectId: Id,
  floorId: Id,
  input: z.unknown(),
  /**
   * Runs on this provider and model instead of the pass's defaults (`defaultModels` in
   * `@el-karta/ai-passes`), without a fallback. Refused unless the function has that provider.
   */
  model: z
    .object({
      provider: z.string().regex(/^[a-z0-9-]{1,40}$/),
      model: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
    })
    .optional(),
});
export type AiRunRequest = z.infer<typeof AiRunRequest>;

/**
 * Stores a pass's merged output as pending suggestions. `runIds` are the runs it came from; a
 * suggestion records its run only when there was exactly one (tiles merge items across runs).
 * Each `requires` id must be in the same commit or already stored on the floor.
 */
export const AiCommitRequest = z.object({
  action: z.literal('commit'),
  pass: z.string().min(1),
  projectId: Id,
  floorId: Id,
  runIds: z.array(Id).max(200),
  /** Provenance source for accepted items; must start with `ai:<pass>:`. */
  source: z.string().min(1),
  suggestions: z.array(SuggestionDraft).min(1),
});
export type AiCommitRequest = z.infer<typeof AiCommitRequest>;

export const AiPassRequest = z.discriminatedUnion('action', [AiRunRequest, AiCommitRequest]);
export type AiPassRequest = z.infer<typeof AiPassRequest>;

/** Same values as `RunStatus` in `@el-karta/ai-passes` and the `ai_runs.status` check. */
export type AiRunStatus = 'ok' | 'invalid' | 'error' | 'rate_limited';

export interface AiRunResponse {
  /** The last attempt's run: the fallback's when the primary provider failed. */
  runId: Id;
  /** Provider and model of that attempt, for the provenance of what it suggested. */
  provider: string;
  model: string;
  status: AiRunStatus;
  /** The parsed pass output, or null when the model gave nothing usable. */
  output: unknown;
  issues: Issue[];
  error?: string;
}

export interface AiCommitResponse {
  ids: Id[];
}

export const AiPassErrorCode = z.enum([
  'bad_request',
  'unauthorized',
  'forbidden',
  'unknown_pass',
  'rate_limited',
  'too_large',
  'conflict',
  'internal',
]);
export type AiPassErrorCode = z.infer<typeof AiPassErrorCode>;

/** Body of every non-2xx response. `rate_limited` here is the per-user limit, not the provider's. */
export const AiPassErrorBody = z.object({
  error: z.object({ code: AiPassErrorCode, message: z.string() }),
});
export type AiPassErrorBody = z.infer<typeof AiPassErrorBody>;
