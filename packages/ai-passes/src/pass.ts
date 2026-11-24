import type { AiProvider, ImageInput, ProviderErrorKind, Usage } from '@el-karta/ai-providers';
import type { Id, Issue, SuggestionDraft } from '@el-karta/core';
import type { z } from 'zod';

export interface Prompt {
  system: string;
  text: string;
  images: ImageInput[];
}

/** A part of a larger image, in pixels of the full image. */
export interface Tile {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileOutput<Out> {
  tile: Tile;
  output: Out;
}

/**
 * One AI feature (PLAN.md "AI pipeline"). `In` is everything the pass needs, already reduced by the
 * caller to the relevant subset of the model; `Opts` is what turning the output into suggestions
 * needs (for example the background placement and scale).
 */
export interface AiPass<In, Out, Opts> {
  readonly id: string;
  /** Validates `In` where it arrives from outside (the Edge Function request body). */
  readonly inputSchema: z.ZodType<In>;
  readonly outputSchema: z.ZodType<Out>;
  prompt(input: In): Prompt;
  /** Deterministic checks; any `error` triggers the one retry. */
  validate(output: Out, input: In): Issue[];
  /** Joins the outputs of several tiles into one output in full-image coordinates. */
  merge?(parts: readonly TileOutput<Out>[]): Out;
  toSuggestions(output: Out, options: Opts, newId: () => Id): SuggestionDraft[];
}

// The registry stores passes without their type parameters; each caller narrows with its own pass.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAiPass = AiPass<any, any, any>;

export type RunStatus = 'ok' | 'invalid' | 'error' | 'rate_limited';

/** Everything `ai_runs` logs, plus the output. */
export interface RunResult<Out> {
  status: RunStatus;
  output: Out | null;
  /** Issues left after the retry; shown with the suggestions, never silently dropped. */
  issues: Issue[];
  validationRetries: number;
  usage: Usage;
  images: number;
  model: string;
  modelVersion?: string;
  durationMs: number;
  error?: string;
  /** Set when a provider failure ended the run (`status` `error` or `rate_limited`). */
  providerFailure?: ProviderErrorKind;
}

export interface RunOptions {
  provider: AiProvider;
  model: string;
  /** Epoch milliseconds after which no provider call starts (`GenerateRequest.deadline`). */
  deadline?: number;
}
