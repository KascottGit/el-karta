import { createFakeProvider, toAnthropicSchema, type AiProvider } from '@el-karta/ai-providers';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { allPasses, defaultModels, planModels } from '../src/index.ts';

const provider = (id: string): AiProvider => ({
  id,
  generateStructured: () => Promise.reject(new Error('not called')),
});
const anthropic = provider('anthropic');
const gemini = provider('gemini');
const providers = (...list: AiProvider[]) => new Map(list.map((p) => [p.id, p]));

const summary = (plan: ReturnType<typeof planModels>) =>
  plan.ok ? plan.attempts.map((a) => `${a.provider.id}:${a.model}`) : plan.reason;

describe('defaultModels', () => {
  it('gives every registered pass Claude Haiku first and Gemini as the fallback', () => {
    for (const pass of allPasses) {
      expect(defaultModels[pass.id]).toEqual({
        primary: { provider: 'anthropic', model: 'claude-haiku-5-5' },
        fallback: { provider: 'gemini', model: 'gemini-3-flash-preview' },
      });
    }
  });

  it('every pass output schema is accepted by the Anthropic schema transform', () => {
    for (const pass of allPasses) {
      const schema = z.toJSONSchema(pass.outputSchema, { io: 'input' }) as Record<string, unknown>;
      expect(() => toAnthropicSchema(schema)).not.toThrow();
      expect(toAnthropicSchema(schema)).toMatchObject({ additionalProperties: false });
    }
  });
});

describe('planModels', () => {
  it('tries the primary, then the fallback', () => {
    expect(summary(planModels('floorplan', providers(anthropic, gemini)))).toEqual([
      'anthropic:claude-haiku-5-5',
      'gemini:gemini-3-flash-preview',
    ]);
  });

  it('skips a choice whose provider has no key', () => {
    expect(summary(planModels('floorplan', providers(gemini)))).toEqual([
      'gemini:gemini-3-flash-preview',
    ]);
    expect(summary(planModels('floorplan', providers(anthropic)))).toEqual([
      'anthropic:claude-haiku-5-5',
    ]);
  });

  it('refuses when no provider is configured, or the pass has no default', () => {
    expect(summary(planModels('floorplan', providers()))).toMatch(/anthropic or gemini/);
    expect(summary(planModels('unknown', providers(anthropic)))).toMatch(/No default model/);
  });

  it('runs a requested choice alone, and only on a configured provider', () => {
    const requested = { provider: 'gemini', model: 'gemini-x' };
    expect(summary(planModels('floorplan', providers(anthropic, gemini), requested))).toEqual([
      'gemini:gemini-x',
    ]);
    expect(summary(planModels('floorplan', providers(anthropic), requested))).toMatch(
      /needs gemini/,
    );
    expect(
      summary(planModels('unknown', providers(gemini), { provider: 'gemini', model: 'g' })),
    ).toEqual(['gemini:g']);
  });

  it('runs every choice once on a configured fake provider', () => {
    const fake = createFakeProvider([{}]);
    expect(summary(planModels('floorplan', providers(fake)))).toEqual(['fake:claude-haiku-5-5']);
    expect(
      summary(planModels('test-echo', providers(fake), { provider: 'fake', model: 'fake-model' })),
    ).toEqual(['fake:fake-model']);
  });
});
