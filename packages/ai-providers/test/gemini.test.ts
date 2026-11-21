import { describe, expect, it } from 'vitest';
import { createGeminiProvider, ProviderError, type GenerateRequest } from '../src/index.ts';

const request: GenerateRequest = {
  model: 'gemini-test',
  system: 'You read floor plans.',
  messages: [
    { role: 'user', text: 'Find the walls.' },
    { role: 'model', text: '{"walls":[]}' },
    { role: 'user', text: 'Try again.' },
  ],
  images: [{ mimeType: 'image/png', data: 'aW1n' }],
  jsonSchema: { type: 'object', properties: { walls: { type: 'array' } } },
};

const okBody = {
  candidates: [
    { content: { role: 'model', parts: [{ text: '{"walls":[1]}' }] }, finishReason: 'STOP' },
  ],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 12 },
  modelVersion: 'gemini-test-002',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Recorded {
  url: string;
  body: Record<string, unknown>;
}

function mockFetch(responses: (() => Response)[]) {
  const calls: Recorded[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      body: JSON.parse(init?.body as string) as Record<string, unknown>,
    });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (!next) throw new Error('no response');
    return Promise.resolve(next());
  };
  return { fetch, calls };
}

function setup(responses: (() => Response)[]) {
  const mock = mockFetch(responses);
  const sleeps: number[] = [];
  const provider = createGeminiProvider({
    apiKey: 'key',
    fetch: mock.fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { provider, calls: mock.calls, sleeps };
}

describe('createGeminiProvider', () => {
  it('sends images, system instruction and JSON Schema, and maps the reply', async () => {
    const { provider, calls } = setup([() => json(200, okBody)]);
    const response = await provider.generateStructured(request);

    expect(response).toEqual({
      text: '{"walls":[1]}',
      modelVersion: 'gemini-test-002',
      usage: { inputTokens: 120, outputTokens: 42 },
    });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toContain('models/gemini-test:generateContent');
    expect(call.body['contents']).toEqual([
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: 'aW1n' } },
          { text: 'Find the walls.' },
        ],
      },
      { role: 'model', parts: [{ text: '{"walls":[]}' }] },
      { role: 'user', parts: [{ text: 'Try again.' }] },
    ]);
    expect(call.body['systemInstruction']).toMatchObject({
      parts: [{ text: 'You read floor plans.' }],
    });
    expect(call.body['generationConfig']).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: request.jsonSchema,
    });
  });

  it('retries 429 and 503 with backoff and then succeeds', async () => {
    const { provider, calls, sleeps } = setup([
      () => json(429, { error: { code: 429, message: 'quota' } }),
      () => json(503, { error: { code: 503, message: 'overloaded' } }),
      () => json(200, okBody),
    ]);
    const response = await provider.generateStructured(request);
    expect(response.text).toBe('{"walls":[1]}');
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('gives up after three attempts with rate_limited', async () => {
    const { provider, calls } = setup([
      () => json(429, { error: { code: 429, message: 'quota' } }),
    ]);
    const error = await provider.generateStructured(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: 'rate_limited' });
    expect(calls).toHaveLength(3);
  });

  it('gives up on a persistent 503 with error', async () => {
    const { provider, calls } = setup([() => json(503, { error: { code: 503, message: 'down' } })]);
    await expect(provider.generateStructured(request)).rejects.toMatchObject({ kind: 'error' });
    expect(calls).toHaveLength(3);
  });

  it('does not retry other failures', async () => {
    const { provider, calls, sleeps } = setup([
      () => json(400, { error: { code: 400, message: 'bad schema' } }),
    ]);
    await expect(provider.generateStructured(request)).rejects.toMatchObject({
      kind: 'error',
      message: expect.stringContaining('bad schema') as unknown,
    });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('turns a reply without text into an error', async () => {
    const { provider } = setup([
      () => json(200, { candidates: [{ finishReason: 'SAFETY' }], usageMetadata: {} }),
    ]);
    await expect(provider.generateStructured(request)).rejects.toMatchObject({
      kind: 'error',
      message: expect.stringContaining('SAFETY') as unknown,
    });
  });
});

describe('createGeminiProvider timeouts', () => {
  it('gives up on a request that never answers, retrying it like an overloaded model', async () => {
    let attempts = 0;
    const hanging = (_input: string | URL | Request, init?: RequestInit) => {
      attempts++;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        });
      });
    };
    const provider = createGeminiProvider({
      apiKey: 'key',
      fetch: hanging,
      timeoutMs: 20,
      sleep: () => Promise.resolve(),
    });
    const error = await provider
      .generateStructured({
        model: 'm',
        system: 's',
        messages: [{ role: 'user', text: 'hi' }],
        images: [],
        jsonSchema: {},
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe('error');
    expect((error as ProviderError).message).toMatch(/within 0.02 s/);
    expect(attempts).toBe(3);
  });
});
