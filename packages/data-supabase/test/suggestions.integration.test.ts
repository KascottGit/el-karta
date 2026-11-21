import { readFileSync } from 'node:fs';
import { generateProject, type Model, type SuggestionDraft } from '@el-karta/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AI_PASS_FUNCTION,
  AI_PASS_MAX_BODY_BYTES,
  AiPassError,
  RepositoryError,
  SuggestionRepository,
  SupabaseRepository,
} from '../src/index.ts';
import { readCapped } from '../../../supabase/functions/ai-pass/body.ts';
import { localStack, signedInUser } from './local-supabase.ts';

// The function must be served with this file: `pnpm supabase functions serve --env-file <it>`.
const envFile = new URL('./ai-pass.env', import.meta.url);
const runsPerHour = Number(/^AI_RUNS_PER_HOUR=(\d+)$/m.exec(readFileSync(envFile, 'utf8'))![1]);

const pass = 'test-echo';
const model = 'fake-model';
const source = `ai:${pass}:${model}`;

const newProject = (): Model => generateProject('small', Math.floor(Math.random() * 2 ** 31));

async function sharedFloor() {
  const owner = await signedInUser('owner');
  const viewer = await signedInUser('viewer');
  const outsider = await signedInUser('outsider');
  const created = await new SupabaseRepository(owner.client).createProject(newProject());
  await new SupabaseRepository(owner.client).shareProject(
    created.project.id,
    viewer.email,
    'viewer',
  );
  const floorId = Object.keys(created.floors)[0]!;
  return {
    owner,
    projectId: created.project.id,
    floorId,
    ownerRepo: new SuggestionRepository(owner.client),
    viewerRepo: new SuggestionRepository(viewer.client),
    outsiderRepo: new SuggestionRepository(outsider.client),
  };
}

function wallAndDoor(): SuggestionDraft[] {
  const wallId = crypto.randomUUID();
  const wall: SuggestionDraft = {
    id: crypto.randomUUID(),
    kind: 'wall',
    payload: { id: wallId, a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.1 },
    confidence: 0.9,
    issues: [],
    requires: [],
  };
  const door: SuggestionDraft = {
    id: crypto.randomUUID(),
    kind: 'opening',
    payload: {
      id: crypto.randomUUID(),
      wallId,
      kind: 'door',
      offset: 1,
      width: 0.9,
      height: 2.1,
      ignored: 'stripped by the kind schema',
    },
    issues: [{ code: 'scale.door-width-implausible', severity: 'warning', params: { width: 0.9 } }],
    requires: [wall.id],
  };
  return [wall, door];
}

const refusal = (code: string): unknown => expect.objectContaining({ name: 'AiPassError', code });

describe('ai-pass function and SuggestionRepository (local Supabase, AI_PROVIDER=fake)', () => {
  beforeAll(async () => {
    const response = await fetch(`${localStack().url}/functions/v1/${AI_PASS_FUNCTION}`, {
      method: 'OPTIONS',
    });
    if (response.status !== 204) {
      throw new Error(
        `The ai-pass function is not served (${response.status}). Run: pnpm supabase functions serve --env-file packages/data-supabase/test/ai-pass.env`,
      );
    }
  });

  it('runs a pass with one retry and logs the run as the caller', async () => {
    const { owner, projectId, floorId, ownerRepo } = await sharedFloor();
    const result = await ownerRepo.runPass({
      pass,
      projectId,
      floorId,
      model,
      input: { text: 'Kök' },
    });
    expect(result).toMatchObject({ status: 'ok', output: { labels: ['Kök'] }, issues: [] });

    const { data, error } = await owner.client
      .from('ai_runs')
      .select('*')
      .eq('id', result.runId)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      project_id: projectId,
      floor_id: floorId,
      user_id: owner.userId,
      pass,
      provider: 'fake',
      model,
      model_version: `fake:${model}`,
      images: 0,
      validation_retries: 1,
      status: 'ok',
      error: null,
    });
    expect(data!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('refuses viewers, outsiders, unknown passes, bad input and oversized requests', async () => {
    const { projectId, floorId, ownerRepo, viewerRepo, outsiderRepo } = await sharedFloor();
    const request = { pass, projectId, floorId, model, input: { text: 'x' } };
    await expect(viewerRepo.runPass(request)).rejects.toEqual(refusal('forbidden'));
    await expect(outsiderRepo.runPass(request)).rejects.toEqual(refusal('forbidden'));
    await expect(ownerRepo.runPass({ ...request, floorId: crypto.randomUUID() })).rejects.toEqual(
      refusal('forbidden'),
    );
    await expect(ownerRepo.runPass({ ...request, pass: 'nope' })).rejects.toEqual(
      refusal('unknown_pass'),
    );
    await expect(ownerRepo.runPass({ ...request, input: { text: 1 } })).rejects.toEqual(
      refusal('bad_request'),
    );
    await expect(
      ownerRepo.runPass({ ...request, input: { text: 'x'.repeat(AI_PASS_MAX_BODY_BYTES) } }),
    ).rejects.toEqual(refusal('too_large'));
    await expect(
      viewerRepo.commitSuggestions({ ...commitOf(request), suggestions: wallAndDoor() }),
    ).rejects.toEqual(refusal('forbidden'));
  });

  it('refuses an oversized body that comes without a Content-Length', async () => {
    const { owner, projectId, floorId } = await sharedFloor();
    const { data } = await owner.client.auth.getSession();
    const { url, anonKey } = localStack();
    const encoder = new TextEncoder();
    const head = JSON.stringify({ action: 'run', pass, projectId, floorId, model, input: {} });
    const chunk = encoder.encode(' '.repeat(1024 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 0) controller.enqueue(encoder.encode(head));
        if (sent > 6) controller.close();
        else controller.enqueue(chunk);
        sent++;
      },
    });
    const response = await fetch(`${url}/functions/v1/${AI_PASS_FUNCTION}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${data.session!.access_token}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body,
      duplex: 'half',
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: 'too_large', message: expect.any(String) as unknown },
    });
  });

  // The local gateway buffers the body and adds a Content-Length, so the reader is tested directly.
  it('stops reading a streamed body as soon as it passes the cap', async () => {
    let pulls = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1000));
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(await readCapped(endless, 4500)).toBeNull();
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(10);

    const small = new Request('http://x', { method: 'POST', body: '{"a":1}' });
    const bytes = await readCapped(small.body, 7);
    expect(new TextDecoder().decode(bytes!)).toBe('{"a":1}');
    expect(await readCapped(null, 0)).toEqual(new Uint8Array(0));
  });

  it('refuses a request without a signed-in user', async () => {
    const { url, anonKey } = localStack();
    const response = await fetch(`${url}/functions/v1/${AI_PASS_FUNCTION}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'unauthorized', message: expect.any(String) as unknown },
    });
  });

  it(`refuses the run after ${runsPerHour} in an hour`, async () => {
    const { projectId, floorId, ownerRepo } = await sharedFloor();
    const request = { pass, projectId, floorId, model, input: { text: 'x' } };
    for (let i = 0; i < runsPerHour; i++) {
      expect((await ownerRepo.runPass(request)).status).toBe('ok');
    }
    const refused = ownerRepo.runPass(request);
    await expect(refused).rejects.toBeInstanceOf(AiPassError);
    await expect(refused).rejects.toEqual(refusal('rate_limited'));
    await expect(
      ownerRepo.commitSuggestions({ ...commitOf(request), suggestions: wallAndDoor() }),
    ).resolves.toEqual({ ids: expect.any(Array) as unknown });
  });

  it('commits suggestions that members list and writers decide on', async () => {
    const { projectId, floorId, ownerRepo, viewerRepo, outsiderRepo } = await sharedFloor();
    const run = await ownerRepo.runPass({ pass, projectId, floorId, model, input: { text: 'x' } });
    const [wall, door] = wallAndDoor();
    const committed = await ownerRepo.commitSuggestions({
      pass,
      projectId,
      floorId,
      runIds: [run.runId],
      source,
      suggestions: [wall!, door!],
    });
    expect(committed.ids).toEqual([wall!.id, door!.id]);

    // One commit shares a created_at, so its rows come back in id order.
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    const listed = await viewerRepo.listSuggestions(floorId);
    expect(listed.map((s) => s.id)).toEqual([wall!.id, door!.id].sort());
    expect(listed.sort(byId)).toEqual(
      [
        {
          ...wall!,
          projectId,
          floorId,
          runId: run.runId,
          pass,
          source,
          status: 'pending',
        },
        {
          ...door!,
          payload: { ...(door!.payload as object), ignored: undefined },
          projectId,
          floorId,
          runId: run.runId,
          pass,
          source,
          status: 'pending',
        },
      ].sort(byId),
    );
    const storedDoor = listed.find((s) => s.id === door!.id)!;
    expect((storedDoor.payload as Record<string, unknown>)['ignored']).toBeUndefined();
    expect(await outsiderRepo.listSuggestions(floorId)).toEqual([]);

    await expect(viewerRepo.setStatus([wall!.id], 'rejected')).rejects.toThrow(RepositoryError);
    await ownerRepo.setStatus([wall!.id, door!.id], 'accepted');
    expect(await ownerRepo.listSuggestions(floorId, ['pending'])).toEqual([]);
    expect(
      (await ownerRepo.listSuggestions(floorId, ['accepted'])).map((s) => s.id).sort(),
    ).toEqual([wall!.id, door!.id].sort());

    // A later commit may require a suggestion that is already stored.
    const second = wallAndDoor()[1]!;
    await expect(
      ownerRepo.commitSuggestions({
        pass,
        projectId,
        floorId,
        runIds: [],
        source,
        suggestions: [{ ...second, requires: [wall!.id] }],
      }),
    ).resolves.toEqual({ ids: [second.id] });
    expect((await ownerRepo.listSuggestions(floorId)).at(-1)!.runId).toBeNull();
  });

  it('refuses commits that do not fit the kinds, their requirements or their runs', async () => {
    const { projectId, floorId, ownerRepo } = await sharedFloor();
    const base = { pass, projectId, floorId, runIds: [], source };
    const [wall, door] = wallAndDoor();
    const cases: [string, Parameters<SuggestionRepository['commitSuggestions']>[0]][] = [
      ['unknown kind', { ...base, suggestions: [{ ...wall!, kind: 'unicorn' }] }],
      ['bad payload', { ...base, suggestions: [{ ...wall!, payload: { id: wall!.id } }] }],
      ['missing requirement', { ...base, suggestions: [door!] }],
      ['duplicate ids', { ...base, suggestions: [wall!, wall!] }],
      ['foreign source', { ...base, source: 'ai:other:m', suggestions: [wall!] }],
      ['unknown run', { ...base, runIds: [crypto.randomUUID()], suggestions: [wall!] }],
    ];
    for (const [label, request] of cases) {
      await expect(ownerRepo.commitSuggestions(request), label).rejects.toEqual(
        refusal('bad_request'),
      );
    }
    expect(await ownerRepo.listSuggestions(floorId)).toEqual([]);

    await ownerRepo.commitSuggestions({ ...base, suggestions: [wall!] });
    await expect(ownerRepo.commitSuggestions({ ...base, suggestions: [wall!] })).rejects.toEqual(
      refusal('conflict'),
    );
  });
});

function commitOf(request: { pass: string; projectId: string; floorId: string }) {
  return { ...request, runIds: [], source };
}
