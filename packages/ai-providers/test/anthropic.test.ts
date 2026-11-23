import { describe, expect, it } from 'vitest';
import { createAnthropicProvider, ProviderError, type GenerateRequest } from '../src/index.ts';

const request: GenerateRequest = {
  model: 'claude-test',
  system: 'You read floor plans.',
  messages: [
    { role: 'user', text: 'Find the walls.' },
    { role: 'model', text: '{"walls":[]}' },
    { role: 'user', text: 'Try again.' },
  ],
  images: [{ mimeType: 'image/png', data: 'aW1n' }],
  jsonSchema: {
    type: 'object',
    properties: { walls: { type: 'array', items: { type: 'integer', minimum: 0 } } },
    required: ['walls'],
  },
};

interface Reply {
  text?: string;
  stopReason?: string;
  model?: string;
}

/** A Messages API stream as the API sends it: server-sent events. */
function stream({
  text = '{"walls":[1]}',
  stopReason = 'end_turn',
  model = 'claude-test-001',
}: Reply) {
  const events: [string, unknown][] = [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 5,
            output_tokens: 1,
          },
        },
      },
    ],
    [
      'content_block_start',
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ...(text === ''
      ? []
      : ([
          [
            'content_block_start',
            { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
          ],
          [
            'content_block_delta',
            { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } },
          ],
          ['content_block_stop', { type: 'content_block_stop', index: 1 }],
        ] as [string, unknown][])),
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: 42 },
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ];
  const body = events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const apiError = (status: number, type: string) =>
  new Response(JSON.stringify({ type: 'error', error: { type, message: `${type} happened` } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A stream that fails part-way, as the API reports an overload after the response started. */
const streamError = (type: string) =>
  new Response(
    `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type, message: 'mid-stream' } })}\n\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

interface Recorded {
  url: string;
  body: Record<string, unknown>;
}

function setup(responses: (() => Response)[]) {
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
  const sleeps: number[] = [];
  const provider = createAnthropicProvider({
    apiKey: 'key',
    fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { provider, calls, sleeps };
}

describe('createAnthropicProvider', () => {
  it('sends images first in the first user message, the system prompt and a closed JSON Schema', async () => {
    const { provider, calls } = setup([() => stream({})]);
    await provider.generateStructured(request);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toMatch(/\/v1\/messages$/);
    expect(call.body['model']).toBe('claude-test');
    expect(call.body['stream']).toBe(true);
    expect(call.body['system']).toBe('You read floor plans.');
    expect(call.body['messages']).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1n' } },
          { type: 'text', text: 'Find the walls.' },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: '{"walls":[]}' }] },
      { role: 'user', content: [{ type: 'text', text: 'Try again.' }] },
    ]);
    const format = (call.body['output_config'] as { format: { type: string; schema: unknown } })
      .format;
    expect(format.type).toBe('json_schema');
    expect(format.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['walls'],
      properties: { walls: { type: 'array', items: { type: 'integer' } } },
    });
    expect(JSON.stringify(format.schema)).not.toContain('"minimum"');
    expect(request.jsonSchema['additionalProperties']).toBeUndefined();
  });

  it('returns the text, the answering model and usage with cached prompt tokens as input', async () => {
    const { provider } = setup([() => stream({})]);
    expect(await provider.generateStructured(request)).toEqual({
      text: '{"walls":[1]}',
      modelVersion: 'claude-test-001',
      usage: { inputTokens: 125, outputTokens: 42 },
    });
  });

  it('retries 503, 529 and overload inside a stream, then succeeds', async () => {
    const { provider, calls, sleeps } = setup([
      () => apiError(503, 'api_error'),
      () => streamError('overloaded_error'),
      () => stream({}),
    ]);
    expect((await provider.generateStructured(request)).text).toBe('{"walls":[1]}');
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);

    const overloaded = setup([() => apiError(529, 'overloaded_error'), () => stream({})]);
    await overloaded.provider.generateStructured(request);
    expect(overloaded.calls).toHaveLength(2);
  });

  it('gives up on a persistent 429 with rate_limited, after three attempts', async () => {
    const { provider, calls } = setup([() => apiError(429, 'rate_limit_error')]);
    const error = await provider.generateStructured(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: 'rate_limited' });
    expect(calls).toHaveLength(3);
  });

  it('does not retry a bad request', async () => {
    const { provider, calls, sleeps } = setup([() => apiError(400, 'invalid_request_error')]);
    await expect(provider.generateStructured(request)).rejects.toMatchObject({
      kind: 'error',
      message: expect.stringContaining('invalid_request_error happened') as unknown,
    });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it.each(['refusal', 'max_tokens'])('turns stop_reason %s into an error', async (stopReason) => {
    const { provider, calls } = setup([() => stream({ stopReason })]);
    const error = await provider.generateStructured(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      kind: 'error',
      message: expect.stringContaining(stopReason) as unknown,
    });
    expect(calls).toHaveLength(1);
  });

  it('turns an answer without text into an error', async () => {
    const { provider } = setup([() => stream({ text: '' })]);
    await expect(provider.generateStructured(request)).rejects.toMatchObject({
      kind: 'error',
      message: expect.stringContaining('no text') as unknown,
    });
  });

  it('refuses an image type Claude does not take, before calling', async () => {
    const { provider, calls } = setup([() => stream({})]);
    await expect(
      provider.generateStructured({ ...request, images: [{ mimeType: 'image/tiff', data: 'x' }] }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toHaveLength(0);
  });
});

describe('createAnthropicProvider timeouts', () => {
  it('aborts a request that never answers and retries it like an overloaded model', async () => {
    let attempts = 0;
    const hanging = (_input: string | URL | Request, init?: RequestInit) => {
      attempts++;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        });
      });
    };
    const provider = createAnthropicProvider({
      apiKey: 'key',
      fetch: hanging,
      timeoutMs: 20,
      sleep: () => Promise.resolve(),
    });
    const error = await provider.generateStructured(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe('error');
    expect((error as ProviderError).message).toMatch(/within 0.02 s/);
    expect(attempts).toBe(3);
  });
});
