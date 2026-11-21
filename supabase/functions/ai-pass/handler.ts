import { defaultModels, runPass, type PassRegistry } from '@el-karta/ai-passes';
import { createProviderFromEnv } from '@el-karta/ai-providers';
import type { Id, SuggestionKinds } from '@el-karta/core';
import {
  AI_PASS_MAX_BODY_BYTES,
  AiPassRequest,
  DEFAULT_AI_RUNS_PER_HOUR,
  type AiCommitRequest,
  type AiCommitResponse,
  type AiPassErrorBody,
  type AiPassErrorCode,
  type AiRunRequest,
  type AiRunResponse,
  type Database,
  type ElKartaClient,
} from '@el-karta/data-supabase';
import { z } from 'zod';

type Json = Database['public']['Tables']['suggestions']['Insert']['payload'];

export interface AiPassDeps {
  env: Record<string, string | undefined>;
  passes: PassRegistry;
  kinds: SuggestionKinds;
  /** A client that acts as the caller: anon key plus the caller's Authorization header. */
  clientFor(authorization: string): ElKartaClient;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const httpStatus: Record<AiPassErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  unknown_pass: 400,
  rate_limited: 429,
  too_large: 413,
  conflict: 409,
  internal: 500,
};

class Refusal extends Error {
  constructor(
    readonly code: AiPassErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

const refuse = (code: AiPassErrorCode, message: string) =>
  json({ error: { code, message } } satisfies AiPassErrorBody, httpStatus[code]);

/** The `ai-pass` Edge Function (ADR 0007). Every database call runs as the caller under RLS. */
export function createAiPassHandler(deps: AiPassDeps): (request: Request) => Promise<Response> {
  const runsPerHour = parseRunsPerHour(deps.env['AI_RUNS_PER_HOUR']);

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return refuse('bad_request', 'Use POST');
    try {
      const authorization = request.headers.get('Authorization');
      if (!authorization?.startsWith('Bearer ')) {
        throw new Refusal('unauthorized', 'Sign in first');
      }
      const client = deps.clientFor(authorization);
      const { error: authError } = await client.auth.getUser(authorization.slice(7));
      if (authError) throw new Refusal('unauthorized', 'Sign in first');
      const body = await readBody(request);
      await checkWriteAccess(client, body.projectId, body.floorId);
      const pass = deps.passes.get(body.pass);
      if (!pass) throw new Refusal('unknown_pass', `No AI pass "${body.pass}"`);
      return body.action === 'run'
        ? json(await run(deps, runsPerHour, client, body))
        : json(await commit(deps, client, body));
    } catch (error) {
      if (error instanceof Refusal) return refuse(error.code, error.message);
      console.error(error);
      return refuse('internal', 'Internal error');
    }
  };
}

/** Falls back to the default unless the value is a positive integer, so a typo cannot lift the limit. */
function parseRunsPerHour(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_AI_RUNS_PER_HOUR;
}

async function readBody(request: Request): Promise<AiPassRequest> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > AI_PASS_MAX_BODY_BYTES) throw tooLarge();
  const text = await readCapped(request);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Refusal('bad_request', 'The body is not JSON');
  }
  const parsed = AiPassRequest.safeParse(raw);
  if (!parsed.success) throw new Refusal('bad_request', z.prettifyError(parsed.error));
  return parsed.data;
}

// Content-Length is optional (chunked uploads), so the cap is enforced while reading.
async function readCapped(request: Request): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > AI_PASS_MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const tooLarge = () =>
  new Refusal('too_large', `The request is larger than ${AI_PASS_MAX_BODY_BYTES} bytes`);

async function checkWriteAccess(client: ElKartaClient, projectId: Id, floorId: Id) {
  const [canWrite, floor] = await Promise.all([
    client.rpc('can_write_project', { p_project_id: projectId }),
    client.from('floors').select('id').eq('id', floorId).eq('project_id', projectId).maybeSingle(),
  ]);
  if (canWrite.error) throw new Error(canWrite.error.message);
  if (floor.error) throw new Error(floor.error.message);
  if (!canWrite.data || !floor.data) {
    throw new Refusal('forbidden', 'Only owners and editors of the project can do this');
  }
}

async function run(
  deps: AiPassDeps,
  runsPerHour: number,
  client: ElKartaClient,
  body: AiRunRequest,
): Promise<AiRunResponse> {
  const pass = deps.passes.get(body.pass)!;
  const input = pass.inputSchema.safeParse(body.input);
  if (!input.success) throw new Refusal('bad_request', z.prettifyError(input.error));
  const model = body.model ?? defaultModels[pass.id];
  if (model === undefined) throw new Refusal('bad_request', `No default model for "${pass.id}"`);

  // Concurrent requests can each pass this check, so the limit may be exceeded by a few runs.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const count = await client.rpc('my_ai_run_count', { p_since: since });
  if (count.error) throw new Error(count.error.message);
  if (count.data >= runsPerHour) {
    throw new Refusal('rate_limited', `At most ${runsPerHour} AI runs per hour`);
  }

  const replies = fakeReplies(deps.env);
  const provider = createProviderFromEnv(deps.env, replies ? { fakeReplies: replies } : {});
  const result = await runPass(pass, input.data, { provider, model });
  const logged = await client
    .from('ai_runs')
    .insert({
      project_id: body.projectId,
      floor_id: body.floorId,
      pass: pass.id,
      provider: provider.id,
      model: result.model,
      model_version: result.modelVersion ?? null,
      input_tokens: result.usage.inputTokens ?? null,
      output_tokens: result.usage.outputTokens ?? null,
      images: result.images,
      validation_retries: result.validationRetries,
      status: result.status,
      duration_ms: Math.round(result.durationMs),
      error: result.error ?? null,
    })
    .select('id')
    .single();
  if (logged.error) throw new Error(logged.error.message);
  return {
    runId: logged.data.id,
    status: result.status,
    output: result.output,
    issues: result.issues,
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

function fakeReplies(env: AiPassDeps['env']): unknown[] | undefined {
  if (env['AI_PROVIDER'] !== 'fake') return undefined;
  const raw = env['AI_FAKE_REPLIES'];
  if (raw === undefined) throw new Error('AI_PROVIDER=fake needs AI_FAKE_REPLIES (a JSON array)');
  return z.array(z.unknown()).min(1).parse(JSON.parse(raw));
}

async function commit(
  deps: AiPassDeps,
  client: ElKartaClient,
  body: AiCommitRequest,
): Promise<AiCommitResponse> {
  if (!body.source.startsWith(`ai:${body.pass}:`)) {
    throw new Refusal('bad_request', `The source must start with "ai:${body.pass}:"`);
  }
  const ids = new Set<Id>();
  const payloads = body.suggestions.map((draft, index) => {
    if (ids.has(draft.id)) throw new Refusal('bad_request', `Duplicate suggestion id ${draft.id}`);
    ids.add(draft.id);
    const kind = deps.kinds.get(draft.kind);
    if (!kind)
      throw new Refusal('bad_request', `suggestions[${index}]: unknown kind ${draft.kind}`);
    try {
      return kind.parse(draft.payload) as Json;
    } catch (error) {
      const detail = error instanceof z.ZodError ? z.prettifyError(error) : String(error);
      throw new Refusal('bad_request', `suggestions[${index}] (${draft.kind}): ${detail}`);
    }
  });

  const missing = [...new Set(body.suggestions.flatMap((s) => s.requires))].filter(
    (id) => !ids.has(id),
  );
  if (missing.length > 0) {
    const found = await client
      .from('suggestions')
      .select('id')
      .eq('floor_id', body.floorId)
      .in('id', missing);
    if (found.error) throw new Error(found.error.message);
    if (found.data.length !== missing.length) {
      throw new Refusal('bad_request', 'A suggestion requires one that is not on this floor');
    }
  }

  const runIds = [...new Set(body.runIds)];
  if (runIds.length > 0) {
    const runs = await client
      .from('ai_runs')
      .select('id')
      .eq('project_id', body.projectId)
      .eq('floor_id', body.floorId)
      .eq('pass', body.pass)
      .in('id', runIds);
    if (runs.error) throw new Error(runs.error.message);
    if (runs.data.length !== runIds.length) {
      throw new Refusal('bad_request', `Unknown runs for this floor and pass`);
    }
  }

  const runId = runIds.length === 1 ? runIds[0]! : null;
  const inserted = await client
    .from('suggestions')
    .insert(
      body.suggestions.map((draft, index) => ({
        id: draft.id,
        project_id: body.projectId,
        floor_id: body.floorId,
        run_id: runId,
        pass: body.pass,
        kind: draft.kind,
        source: body.source,
        payload: payloads[index]!,
        confidence: draft.confidence ?? null,
        issues: draft.issues,
        requires: draft.requires,
      })),
    )
    .select('id');
  if (inserted.error) {
    if (inserted.error.code === '23505') {
      throw new Refusal('conflict', 'A suggestion with one of these ids already exists');
    }
    throw new Error(inserted.error.message);
  }
  return { ids: inserted.data.map((row) => row.id) };
}
