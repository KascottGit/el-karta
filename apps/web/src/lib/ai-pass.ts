import {
  AiPassError,
  type AiCommitRequest,
  type AiCommitResponse,
  type AiRunRequest,
  type AiRunResponse,
} from '@el-karta/data-supabase';
import type { SuggestionIssue } from '@el-karta/core';
import type { z } from 'zod';
import { loadSuggestionRepository } from '@/features/suggestions/supabase-source';

/**
 * The `ai-pass` function's two actions (ADR 0007), shared by every pass the app runs: run one pass
 * on its input, and store what it suggests.
 */
export interface AiPassBackend {
  run(request: Omit<AiRunRequest, 'action'>, signal: AbortSignal): Promise<AiRunResponse>;
  commit(request: Omit<AiCommitRequest, 'action'>): Promise<AiCommitResponse>;
}

export const supabaseAiPass: AiPassBackend = {
  run: async (request, signal) => (await loadSuggestionRepository()).runPass(request, { signal }),
  commit: async (request) => (await loadSuggestionRepository()).commitSuggestions(request),
};

/**
 * Provenance source of what a pass suggested: the pass and every model that answered its calls, in
 * the order they first answered (a fallback model joins the primary when it took over some calls).
 */
export const passSource = (pass: string, models: readonly string[]) =>
  `ai:${pass}:${[...new Set(models)].join('+')}`;

/** Why a call to the `ai-pass` function gave nothing to use. */
export type AiPassFailureCode =
  /** The per-user limit of the `ai-pass` function. */
  | 'rate_limited'
  /** The AI provider's own limit or overload. */
  | 'provider_busy'
  | 'too_large'
  | 'forbidden'
  | 'network'
  | 'internal'
  /** The model answered with nothing usable. */
  | 'no_output';

export class AiPassFailure extends Error {
  override name = 'AiPassFailure';
  constructor(readonly code: AiPassFailureCode) {
    super(`AI pass failed: ${code}`);
  }
}

/** The code for any error a call to the function can end with. */
export function aiPassFailureCode(error: unknown): AiPassFailureCode {
  if (error instanceof AiPassFailure) return error.code;
  if (!(error instanceof AiPassError)) return 'internal';
  switch (error.code) {
    case 'rate_limited':
    case 'too_large':
      return error.code;
    case 'forbidden':
    case 'unauthorized':
      return 'forbidden';
    default:
      // Without an HTTP status the request never got an answer.
      return error.status === undefined ? 'network' : 'internal';
  }
}

/** A run's output parsed with the pass's schema; throws `AiPassFailure` when there is none to use. */
export function passOutput<T>(response: AiRunResponse, schema: z.ZodType<T>): T {
  if (response.status === 'rate_limited') throw new AiPassFailure('provider_busy');
  if (response.status === 'error') throw new AiPassFailure('internal');
  const parsed = schema.safeParse(response.output);
  if (response.output === null || !parsed.success) throw new AiPassFailure('no_output');
  return parsed.data;
}

/** The issues left after an `invalid` run's retry, to be shown with what it suggested. */
export const runIssues = (response: AiRunResponse): SuggestionIssue[] =>
  response.status === 'invalid'
    ? response.issues.map(({ code, severity, params }) => ({
        code,
        severity,
        ...(params ? { params } : {}),
      }))
    : [];

export const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError';

/** Rejects with an AbortError as soon as `signal` aborts, whether or not `promise` settles. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}
