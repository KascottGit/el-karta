import type { Usage } from './provider.ts';

/** A price band. `maxInputTokens` bounds the call's prompt; the last tier has none. */
export interface PriceTier {
  maxInputTokens?: number;
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens (thinking tokens included). */
  output: number;
}

export interface ModelPrice {
  provider: string;
  model: string;
  /** Ordered by `maxInputTokens`, ascending. */
  tiers: readonly [PriceTier, ...PriceTier[]];
  /** The date (YYYY-MM-DD) someone last checked these numbers against `source`. */
  checked: string;
  source: string;
}

const GEMINI_PRICING = 'https://aistudio.google.com/docs/pricing';

/** Standard (not batch) API prices. Re-check `source` before relying on a number. */
export const modelPrices: readonly ModelPrice[] = [
  {
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    tiers: [
      { maxInputTokens: 100_000, input: 0.1, output: 0.5 },
      { input: 0.5, output: 2.5 },
    ],
    checked: '2026-11-23',
    source: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
  {
    provider: 'gemini',
    model: 'gemini-3-flash-preview',
    tiers: [{ input: 0.5, output: 3 }],
    checked: '2026-11-23',
    source: GEMINI_PRICING,
  },
  {
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    tiers: [{ input: 0.3, output: 2.5 }],
    checked: '2026-11-23',
    source: GEMINI_PRICING,
  },
  {
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    tiers: [{ input: 0.25, output: 1.5 }],
    checked: '2026-11-23',
    source: GEMINI_PRICING,
  },
];

export const modelPrice = (provider: string, model: string): ModelPrice | undefined =>
  modelPrices.find((p) => p.provider === provider && p.model === model);

/**
 * The cost in USD of `calls` provider calls that together used `usage`, or `undefined` for a model
 * without a price (never a guess). The tier is chosen by the mean input tokens per call, since
 * totals cannot tell which single call crossed a threshold. Missing token counts count as zero: a
 * provider reports usage on every answer it bills.
 */
export function costUsd(
  provider: string,
  model: string,
  usage: Usage,
  calls = 1,
): number | undefined {
  const price = modelPrice(provider, model);
  if (!price) return undefined;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const perCall = input / Math.max(calls, 1);
  const tier =
    price.tiers.find((t) => t.maxInputTokens === undefined || perCall <= t.maxInputTokens) ??
    price.tiers[price.tiers.length - 1]!;
  return (input * tier.input + output * tier.output) / 1_000_000;
}
