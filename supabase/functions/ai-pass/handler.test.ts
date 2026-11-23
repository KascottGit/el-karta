import { createPassRegistry } from '@el-karta/ai-passes';
import {
  createFakeProvider,
  ProviderError,
  type AiProvider,
  type GenerateRequest,
} from '@el-karta/ai-providers';
import { createSuggestionKinds } from '@el-karta/core';
import type { ElKartaClient } from '@el-karta/data-supabase';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiPassHandler, RUN_BUDGET_MS } from './handler.ts';
import { testEchoPass } from './test-pass.ts';

type Row = Record<string, unknown>;

/** Just the calls `run` makes, answering as a member with write access and no runs this hour. */
function fakeClient(runs: Row[]): ElKartaClient {
  const query = (table: string) => {
    let inserted: Row | undefined;
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      insert: (row: Row) => {
        inserted = { id: `run-${runs.length + 1}`, ...row };
        runs.push(inserted);
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: { id: 'floor' }, error: null }),
      single: () => Promise.resolve({ data: { id: inserted?.['id'] }, error: null, table }),
    };
    return builder;
  };
  const client = {
    auth: { getUser: () => Promise.resolve({ data: {}, error: null }) },
    rpc: (name: string) =>
      Promise.resolve({ data: name === 'my_ai_run_count' ? 0 : true, error: null }),
    from: query,
  };
  return client as unknown as ElKartaClient;
}

/** A fake provider under a real provider's id, so `planModels` treats it as that provider. */
const providerAs = (id: string, replies: unknown[]): AiProvider & { calls: GenerateRequest[] } => {
  const fake = createFakeProvider(replies);
  return {
    id,
    calls: fake.calls,
    generateStructured: (request) => fake.generateStructured(request),
  };
};

// The echo pass under the floor-plan pass's id, so it runs with that pass's default models.
const echo = { ...testEchoPass, id: 'floorplan' };

/** Injects `providers`, or reads them from `env` when left out. */
function setup(providers: AiProvider[] | undefined, env: Record<string, string> = {}) {
  const runs: Row[] = [];
  const handler = createAiPassHandler({
    env,
    passes: createPassRegistry([echo, testEchoPass]),
    kinds: createSuggestionKinds(),
    clientFor: () => fakeClient(runs),
    ...(providers ? { providers: () => new Map(providers.map((p) => [p.id, p])) } : {}),
  });
  const run = async (extra: Row = {}) => {
    const response = await handler(
      new Request('http://localhost/ai-pass', {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
        body: JSON.stringify({
          action: 'run',
          pass: 'floorplan',
          projectId: '00000000-0000-4000-8000-000000000001',
          floorId: '00000000-0000-4000-8000-000000000002',
          input: { text: 'x' },
          ...extra,
        }),
      }),
    );
    return { status: response.status, body: (await response.json()) as Row };
  };
  return { run, runs };
}

const ok = { labels: ['Kök'] };
const down = new ProviderError('unavailable', 'Claude did not answer within 70 s');

describe('ai-pass run time budget', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives the primary half the budget and the fallback the rest, or one attempt all of it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const anthropic = providerAs('anthropic', [down]);
    const gemini = providerAs('gemini', [ok]);
    await setup([anthropic, gemini]).run();
    expect(anthropic.calls).toMatchObject([{ deadline: 1_000_000 + RUN_BUDGET_MS / 2 }]);
    expect(gemini.calls).toMatchObject([{ deadline: 1_000_000 + RUN_BUDGET_MS }]);

    const alone = providerAs('gemini', [ok]);
    await setup([alone]).run();
    expect(alone.calls).toMatchObject([{ deadline: 1_000_000 + RUN_BUDGET_MS }]);
    expect(RUN_BUDGET_MS).toBeLessThan(150_000);
  });
});

describe('ai-pass run with a fallback provider', () => {
  it('runs on the primary provider and logs one run', async () => {
    const anthropic = providerAs('anthropic', [ok]);
    const gemini = providerAs('gemini', [ok]);
    const { run, runs } = setup([anthropic, gemini]);
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      runId: 'run-1',
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      status: 'ok',
      output: ok,
    });
    expect(runs).toMatchObject([{ provider: 'anthropic', model: 'claude-haiku-5-5' }]);
    expect(gemini.calls).toHaveLength(0);
  });

  it('falls back when the primary provider fails, logging both attempts', async () => {
    const gemini = providerAs('gemini', [ok]);
    const { run, runs } = setup([providerAs('anthropic', [down]), gemini]);
    const { body } = await run();
    expect(body).toMatchObject({
      runId: 'run-2',
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      status: 'ok',
      output: ok,
    });
    expect(runs).toMatchObject([
      { provider: 'anthropic', model: 'claude-haiku-5-5', status: 'error', error: down.message },
      { provider: 'gemini', model: 'gemini-3-flash-preview', status: 'ok' },
    ]);
  });

  it('falls back on a provider rate limit, and reports the last failure when both fail', async () => {
    const busy = new ProviderError('rate_limited', '429');
    const { run, runs } = setup([providerAs('anthropic', [busy]), providerAs('gemini', [down])]);
    const { body } = await run();
    expect(body).toMatchObject({ runId: 'run-2', status: 'error', output: null });
    expect(runs.map((r) => r['status'])).toEqual(['rate_limited', 'error']);
  });

  it('does not fall back on invalid output', async () => {
    const gemini = providerAs('gemini', [ok]);
    const { run, runs } = setup([providerAs('anthropic', ['not json']), gemini]);
    const { body } = await run();
    expect(body).toMatchObject({ status: 'invalid' });
    expect(runs).toMatchObject([{ provider: 'anthropic', status: 'invalid' }]);
    expect(gemini.calls).toHaveLength(0);
  });

  it.each([
    ['a bad request', new ProviderError('error', '400 invalid_request_error')],
    ['a refusal', new ProviderError('error', 'Claude stopped without an answer (refusal)')],
  ])('does not fall back on %s', async (_name, failure) => {
    const gemini = providerAs('gemini', [ok]);
    const { run, runs } = setup([providerAs('anthropic', [failure]), gemini]);
    expect((await run()).body).toMatchObject({ status: 'error', provider: 'anthropic' });
    expect(runs).toMatchObject([{ provider: 'anthropic', status: 'error' }]);
    expect(gemini.calls).toHaveLength(0);
  });

  it('uses the fallback when the primary provider has no key', async () => {
    const { run, runs } = setup([providerAs('gemini', [ok])]);
    expect((await run()).body).toMatchObject({ status: 'ok' });
    expect(runs).toMatchObject([{ provider: 'gemini', model: 'gemini-3-flash-preview' }]);
  });

  it('refuses a run when no provider is configured, without logging it', async () => {
    const { run, runs } = setup([]);
    const { status, body } = await run();
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: 'bad_request' } });
    expect(runs).toEqual([]);
  });

  it('runs a requested model alone, and refuses one for a provider that is not configured', async () => {
    const anthropic = providerAs('anthropic', [down]);
    const { run, runs } = setup([anthropic, providerAs('gemini', [ok])]);
    const requested = await run({ model: { provider: 'anthropic', model: 'claude-other' } });
    expect(requested.body).toMatchObject({ status: 'error' });
    expect(runs).toMatchObject([{ provider: 'anthropic', model: 'claude-other' }]);

    const refused = await run({ model: { provider: 'mistral', model: 'small' } });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: { code: 'bad_request' } });
    expect(runs).toHaveLength(1);
  });

  it('runs every pass on the fake provider from the environment', async () => {
    const { run, runs } = setup(undefined, {
      AI_PROVIDER: 'fake',
      AI_FAKE_REPLIES: JSON.stringify([ok]),
    });
    expect((await run()).body).toMatchObject({ status: 'ok', output: ok });
    expect(runs).toMatchObject([{ provider: 'fake', model: 'claude-haiku-5-5' }]);
  });
});
