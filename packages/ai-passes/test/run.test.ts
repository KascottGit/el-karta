import { createFakeProvider, ProviderError, type AiProvider } from '@el-karta/ai-providers';
import type { Issue } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runPass, type AiPass } from '../src/index.ts';

const Input = z.object({ max: z.number() });
const Output = z.object({ walls: z.array(z.object({ id: z.string(), length: z.number() })) });
type Output = z.infer<typeof Output>;

const pass: AiPass<z.infer<typeof Input>, Output, null> = {
  id: 'test',
  inputSchema: Input,
  outputSchema: Output,
  prompt: () => ({
    system: 'system',
    text: 'Find walls.',
    images: [{ mimeType: 'image/png', data: 'aW1n' }],
  }),
  validate(output, input) {
    const issues: Issue[] = [];
    for (const wall of output.walls) {
      if (wall.length > input.max) {
        issues.push({
          code: 'test.too-long',
          severity: 'error',
          ids: [wall.id],
          params: { length: wall.length, max: input.max },
        });
      }
      if (wall.length < 1) issues.push({ code: 'test.short', severity: 'warning', ids: [wall.id] });
    }
    return issues;
  },
  toSuggestions: () => [],
};

const good = { walls: [{ id: 'w1', length: 3 }] };
const tooLong = { walls: [{ id: 'w1', length: 30 }] };
const input = { max: 10 };

function clock() {
  let t = 1000;
  return () => (t += 25);
}

describe('runPass', () => {
  it('returns ok when the first answer is valid', async () => {
    const provider = createFakeProvider([good]);
    const result = await runPass(pass, input, { provider, model: 'm', now: clock() });

    expect(result).toEqual({
      status: 'ok',
      output: good,
      issues: [],
      validationRetries: 0,
      usage: {},
      images: 1,
      model: 'm',
      modelVersion: 'fake:m',
      durationMs: 25,
    });
    expect(provider.calls).toHaveLength(1);
    const request = provider.calls[0]!;
    expect(request.system).toBe('system');
    expect(request.messages).toEqual([{ role: 'user', text: 'Find walls.' }]);
    expect(request.images).toHaveLength(1);
    expect(request.jsonSchema).toEqual(z.toJSONSchema(Output, { io: 'input' }));
  });

  it('retries once with the issues and returns the fixed answer', async () => {
    const provider = createFakeProvider([tooLong, good]);
    const result = await runPass(pass, input, { provider, model: 'm' });

    expect(result).toMatchObject({ status: 'ok', output: good, issues: [], validationRetries: 1 });
    expect(provider.calls).toHaveLength(2);
    const retry = provider.calls[1]!.messages;
    expect(retry).toHaveLength(3);
    expect(retry[1]).toEqual({ role: 'model', text: JSON.stringify(tooLong) });
    expect(retry[2]?.role).toBe('user');
    expect(retry[2]?.text).toContain('test.too-long');
    expect(retry[2]?.text).toContain('w1');
    expect(retry[2]?.text).toContain('"max":10');
    expect(provider.calls[1]!.images).toHaveLength(1);
  });

  it('stops after one retry and returns the remaining issues', async () => {
    const provider = createFakeProvider([tooLong]);
    const result = await runPass(pass, input, { provider, model: 'm' });

    expect(provider.calls).toHaveLength(2);
    expect(result.status).toBe('invalid');
    expect(result.output).toEqual(tooLong);
    expect(result.validationRetries).toBe(1);
    expect(result.issues.map((issue) => issue.code)).toEqual(['test.too-long']);
  });

  it('does not retry for warnings', async () => {
    const short = { walls: [{ id: 'w1', length: 0.5 }] };
    const provider = createFakeProvider([short, good]);
    const result = await runPass(pass, input, { provider, model: 'm' });

    expect(provider.calls).toHaveLength(1);
    expect(result.status).toBe('ok');
    expect(result.issues.map((issue) => issue.code)).toEqual(['test.short']);
  });

  it('retries unparseable output with the parse error', async () => {
    const provider = createFakeProvider(['{"walls": [', good]);
    const result = await runPass(pass, input, { provider, model: 'm' });

    expect(result).toMatchObject({ status: 'ok', output: good, validationRetries: 1 });
    const retry = provider.calls[1]!.messages;
    expect(retry[1]).toEqual({ role: 'model', text: '{"walls": [' });
    expect(retry[2]?.text).toMatch(/not valid JSON/);
  });

  it('retries output that does not match the schema', async () => {
    const provider = createFakeProvider([{ walls: [{ id: 'w1' }] }, good]);
    const result = await runPass(pass, input, { provider, model: 'm' });

    expect(result.status).toBe('ok');
    expect(provider.calls[1]!.messages[2]?.text).toMatch(/did not match the JSON Schema/);
    expect(provider.calls[1]!.messages[2]?.text).toContain('length');
  });

  it('is invalid without output when the retry is still unparseable', async () => {
    const provider = createFakeProvider(['nope']);
    const result = await runPass(pass, input, { provider, model: 'm' });

    expect(provider.calls).toHaveLength(2);
    expect(result).toMatchObject({
      status: 'invalid',
      output: null,
      issues: [],
      validationRetries: 1,
    });
    expect(result.error).toMatch(/not valid JSON/);
  });

  it('keeps the first parsed answer when the retry is unparseable', async () => {
    const provider = createFakeProvider([tooLong, 'nope']);
    const result = await runPass(pass, input, { provider, model: 'm' });

    expect(provider.calls).toHaveLength(2);
    expect(result).toMatchObject({ status: 'invalid', output: tooLong, validationRetries: 1 });
    expect(result.issues.map((issue) => issue.code)).toEqual(['test.too-long']);
    expect(result.error).toMatch(/not valid JSON/);
  });

  it('describes the input side of the output schema', async () => {
    const WithDefault = z.object({ walls: z.array(z.string()).default([]) });
    const provider = createFakeProvider([{}]);
    const result = await runPass(
      { ...pass, outputSchema: WithDefault, validate: () => [] } as unknown as typeof pass,
      input,
      { provider, model: 'm' },
    );

    expect(result.output).toEqual({ walls: [] });
    expect(provider.calls[0]!.jsonSchema['required']).toBeUndefined();
  });

  it('reports rate limits and provider errors', async () => {
    const limited = await runPass(pass, input, {
      provider: createFakeProvider([new ProviderError('rate_limited', '429 quota')]),
      model: 'm',
    });
    expect(limited).toMatchObject({
      status: 'rate_limited',
      output: null,
      error: '429 quota',
      providerFailure: 'rate_limited',
    });

    const down = await runPass(pass, input, {
      provider: createFakeProvider([new ProviderError('unavailable', '503')]),
      model: 'm',
    });
    expect(down).toMatchObject({ status: 'error', providerFailure: 'unavailable' });

    const failed = await runPass(pass, input, {
      provider: createFakeProvider([tooLong, new ProviderError('error', 'boom')]),
      model: 'm',
    });
    expect(failed).toMatchObject({
      status: 'error',
      output: null,
      validationRetries: 1,
      error: 'boom',
      providerFailure: 'error',
    });
  });

  it('passes the deadline to every call, and marks no provider failure on its own errors', async () => {
    const provider = createFakeProvider([tooLong, good]);
    await runPass(pass, input, { provider, model: 'm', deadline: 1234 });
    expect(provider.calls.map((call) => call.deadline)).toEqual([1234, 1234]);

    const broken = await runPass(
      {
        ...pass,
        prompt: () => {
          throw new Error('bug');
        },
      },
      input,
      { provider, model: 'm' },
    );
    expect(broken.status).toBe('error');
    expect(broken.providerFailure).toBeUndefined();
  });

  it('refuses invalid input without calling the provider', async () => {
    const provider = createFakeProvider([good]);
    const result = await runPass(pass, { max: 'ten' }, { provider, model: 'm' });

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/Invalid input/);
    expect(provider.calls).toHaveLength(0);
  });

  it('sums token usage over both calls and keeps the last model version', async () => {
    const replies = [JSON.stringify(tooLong), JSON.stringify(good)];
    let call = 0;
    const provider: AiProvider = {
      id: 'counting',
      generateStructured: () => {
        call++;
        return Promise.resolve({
          text: replies[call - 1] ?? '',
          modelVersion: `v${call}`,
          usage: { inputTokens: 100, outputTokens: 10 * call },
        });
      },
    };
    const result = await runPass(pass, input, { provider, model: 'm', now: clock() });

    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 30 });
    expect(result.modelVersion).toBe('v2');
    expect(result.durationMs).toBe(25);
  });
});
