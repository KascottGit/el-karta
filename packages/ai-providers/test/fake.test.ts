import { describe, expect, it } from 'vitest';
import { createFakeProvider, ProviderError, type GenerateRequest } from '../src/index.ts';

const request: GenerateRequest = {
  model: 'm',
  system: 's',
  messages: [{ role: 'user', text: 'hi' }],
  images: [],
  jsonSchema: {},
};

describe('createFakeProvider', () => {
  it('replays replies in order, repeating the last, and records calls', async () => {
    const fake = createFakeProvider([{ a: 1 }, 'not json']);
    expect((await fake.generateStructured(request)).text).toBe('{"a":1}');
    expect((await fake.generateStructured(request)).text).toBe('not json');
    expect((await fake.generateStructured(request)).text).toBe('not json');
    expect(fake.calls).toHaveLength(3);
  });

  it('throws provider errors', async () => {
    const fake = createFakeProvider([new ProviderError('rate_limited', '429')]);
    await expect(fake.generateStructured(request)).rejects.toMatchObject({ kind: 'rate_limited' });
  });
});
