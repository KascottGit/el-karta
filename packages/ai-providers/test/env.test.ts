import { describe, expect, it } from 'vitest';
import { createProvidersFromEnv } from '../src/index.ts';

const ids = (env: Record<string, string | undefined>) => [...createProvidersFromEnv(env).keys()];

describe('createProvidersFromEnv', () => {
  it('returns only the fake provider with the given replies, whatever keys are set', async () => {
    const providers = createProvidersFromEnv(
      { AI_PROVIDER: 'fake', ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' },
      { fakeReplies: [{ ok: 1 }] },
    );
    expect([...providers.keys()]).toEqual(['fake']);
    const response = await providers.get('fake')!.generateStructured({
      model: 'm',
      system: '',
      messages: [],
      images: [],
      jsonSchema: {},
    });
    expect(response.text).toBe('{"ok":1}');
  });

  it('returns every provider that has a key, under its own id', () => {
    const providers = createProvidersFromEnv({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' });
    expect([...providers.keys()]).toEqual(['anthropic', 'gemini']);
    expect(providers.get('anthropic')!.id).toBe('anthropic');
    expect(providers.get('gemini')!.id).toBe('gemini');
    expect(ids({ GEMINI_API_KEY: 'g' })).toEqual(['gemini']);
    expect(ids({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: '' })).toEqual(['anthropic']);
    expect(ids({})).toEqual([]);
  });

  it('keeps only the provider AI_PROVIDER names', () => {
    expect(ids({ AI_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' })).toEqual([
      'gemini',
    ]);
    expect(ids({ AI_PROVIDER: 'anthropic', GEMINI_API_KEY: 'g' })).toEqual([]);
    expect(ids({ AI_PROVIDER: '', GEMINI_API_KEY: 'g' })).toEqual(['gemini']);
  });

  it('refuses an unknown provider or a fake one without replies', () => {
    expect(() => createProvidersFromEnv({ AI_PROVIDER: 'other' })).toThrow(/Unknown/);
    expect(() => createProvidersFromEnv({ AI_PROVIDER: 'toString' })).toThrow(/Unknown/);
    expect(() => createProvidersFromEnv({ AI_PROVIDER: 'fake' })).toThrow(/at least one reply/);
  });
});
