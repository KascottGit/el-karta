import { describe, expect, it } from 'vitest';
import { createProviderFromEnv } from '../src/index.ts';

describe('createProviderFromEnv', () => {
  it('returns the fake provider with the given replies', async () => {
    const provider = createProviderFromEnv({ AI_PROVIDER: 'fake' }, { fakeReplies: [{ ok: 1 }] });
    expect(provider.id).toBe('fake');
    const response = await provider.generateStructured({
      model: 'm',
      system: '',
      messages: [],
      images: [],
      jsonSchema: {},
    });
    expect(response.text).toBe('{"ok":1}');
  });

  it('returns Gemini when a key is set', () => {
    expect(createProviderFromEnv({ GEMINI_API_KEY: 'k' }).id).toBe('gemini');
    expect(createProviderFromEnv({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' }).id).toBe('gemini');
  });

  it('refuses a missing configuration or an unknown provider', () => {
    expect(() => createProviderFromEnv({})).toThrow(/GEMINI_API_KEY/);
    expect(() => createProviderFromEnv({ AI_PROVIDER: 'other', GEMINI_API_KEY: 'k' })).toThrow(
      /Unknown/,
    );
    expect(() => createProviderFromEnv({ AI_PROVIDER: 'fake' })).toThrow(/at least one reply/);
  });
});
