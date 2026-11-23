import { describe, expect, it } from 'vitest';
import { costUsd, modelPrice, modelPrices } from '../src/prices.ts';

describe('costUsd', () => {
  it('prices input and output tokens per 1M', () => {
    expect(
      costUsd('gemini', 'gemini-3-flash-preview', { inputTokens: 3562, outputTokens: 5312 }),
    ).toBeCloseTo((3562 * 0.5 + 5312 * 3) / 1e6, 12);
  });

  it('picks the tier by the mean input tokens per call', () => {
    const usage = { inputTokens: 150_000, outputTokens: 1000 };
    expect(costUsd('anthropic', 'claude-haiku-5-5', usage)).toBeCloseTo(
      (150_000 * 0.5 + 1000 * 2.5) / 1e6,
      12,
    );
    expect(costUsd('anthropic', 'claude-haiku-5-5', usage, 2)).toBeCloseTo(
      (150_000 * 0.1 + 1000 * 0.5) / 1e6,
      12,
    );
    expect(costUsd('anthropic', 'claude-haiku-5-5', { inputTokens: 100_000 })).toBeCloseTo(
      0.01,
      12,
    );
  });

  it('counts missing tokens as zero', () => {
    expect(costUsd('gemini', 'gemini-3-flash-preview', {})).toBe(0);
    expect(costUsd('gemini', 'gemini-3-flash-preview', { outputTokens: 1_000_000 })).toBe(3);
  });

  it('gives no cost for an unknown model or provider', () => {
    expect(costUsd('gemini', 'gemini-9', { inputTokens: 10 })).toBeUndefined();
    expect(costUsd('fake', 'claude-haiku-5-5', { inputTokens: 10 })).toBeUndefined();
  });
});

describe('modelPrices', () => {
  it('has one entry per model, ascending tiers, a check date and a source', () => {
    const keys = modelPrices.map((p) => `${p.provider}/${p.model}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const price of modelPrices) {
      expect(price.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(price.source).toMatch(/^https:\/\//);
      const limits = price.tiers.map((t) => t.maxInputTokens);
      expect(limits.at(-1)).toBeUndefined();
      const bounded = limits.slice(0, -1) as number[];
      expect(bounded).toEqual([...bounded].sort((a, b) => a - b));
    }
    expect(modelPrice('anthropic', 'claude-haiku-5-5')?.tiers[0]).toEqual({
      maxInputTokens: 100_000,
      input: 0.1,
      output: 0.5,
    });
  });
});
