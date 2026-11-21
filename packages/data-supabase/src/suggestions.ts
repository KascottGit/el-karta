import { Suggestion, type Id, type SuggestionStatus } from '@el-karta/core';
import { FunctionsHttpError, type FunctionInvokeOptions } from '@supabase/supabase-js';
import {
  AI_PASS_FUNCTION,
  AiPassErrorBody,
  type AiCommitRequest,
  type AiCommitResponse,
  type AiPassErrorCode,
  type AiPassRequest,
  type AiRunRequest,
  type AiRunResponse,
} from './ai-pass.ts';
import type { Tables } from './database.types.ts';
import { RepositoryError, type ElKartaClient } from './repository.ts';

/** A refusal from the `ai-pass` function, with its code for the UI to translate. */
export class AiPassError extends RepositoryError {
  override name = 'AiPassError';
  constructor(
    override readonly code: AiPassErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message, code);
  }
}

// PostgREST returns at most this many rows per request (the stack's `max_rows`).
const pageSize = 1000;
// Ids go into the URL as an `in` filter, so long lists are sent in parts.
const idsPerRequest = 200;

const suggestionFromRow = (row: Tables<'suggestions'>): Suggestion =>
  Suggestion.parse({
    id: row.id,
    projectId: row.project_id,
    floorId: row.floor_id,
    runId: row.run_id,
    pass: row.pass,
    kind: row.kind,
    source: row.source,
    payload: row.payload,
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
    issues: row.issues,
    requires: row.requires,
    status: row.status,
  });

/**
 * AI suggestions of a floor (ADR 0007), as the signed-in user: members read them, owners and
 * editors run passes, store suggestions and decide on them.
 */
export class SuggestionRepository {
  constructor(private readonly client: ElKartaClient) {}

  /** All suggestions of a floor, oldest first, or only those with the given statuses. */
  async listSuggestions(
    floorId: Id,
    statuses?: readonly SuggestionStatus[],
  ): Promise<Suggestion[]> {
    const all: Suggestion[] = [];
    for (let from = 0; ; from += pageSize) {
      let query = this.client.from('suggestions').select('*').eq('floor_id', floorId);
      if (statuses) query = query.in('status', [...statuses]);
      const { data, error } = await query
        .order('created_at')
        .order('id')
        .range(from, from + pageSize - 1);
      if (error) throw new RepositoryError(error.message, error.code);
      all.push(...data.map(suggestionFromRow));
      if (data.length < pageSize) return all;
    }
  }

  /** Sets the status of every id; fails if any of them could not be changed by this user. */
  async setStatus(ids: readonly Id[], status: SuggestionStatus): Promise<void> {
    for (let i = 0; i < ids.length; i += idsPerRequest) {
      const part = ids.slice(i, i + idsPerRequest);
      const { data, error } = await this.client
        .from('suggestions')
        .update({ status })
        .in('id', part)
        .select('id');
      if (error) throw new RepositoryError(error.message, error.code);
      if (data.length !== new Set(part).size) {
        throw new RepositoryError(
          `Changed ${data.length} of ${part.length} suggestions; the others are missing or read-only`,
        );
      }
    }
  }

  /** `signal` aborts the request; the run may still finish and be logged on the server. */
  runPass(
    request: Omit<AiRunRequest, 'action'>,
    options: Pick<FunctionInvokeOptions, 'signal'> = {},
  ): Promise<AiRunResponse> {
    return this.invoke<AiRunResponse>({ action: 'run', ...request }, options);
  }

  commitSuggestions(request: Omit<AiCommitRequest, 'action'>): Promise<AiCommitResponse> {
    return this.invoke<AiCommitResponse>({ action: 'commit', ...request });
  }

  private async invoke<T>(
    body: AiPassRequest,
    options: Pick<FunctionInvokeOptions, 'signal'> = {},
  ): Promise<T> {
    const result = await this.client.functions.invoke<T>(AI_PASS_FUNCTION, { ...options, body });
    if (!result.error) return result.data as T;
    const error: unknown = result.error;
    if (error instanceof FunctionsHttpError) {
      const response = error.context as { status: number; json(): Promise<unknown> };
      const parsed = AiPassErrorBody.safeParse(await response.json().catch(() => null));
      if (parsed.success) {
        throw new AiPassError(parsed.data.error.code, parsed.data.error.message, response.status);
      }
      throw new AiPassError('internal', `ai-pass answered ${response.status}`, response.status);
    }
    throw new AiPassError('internal', error instanceof Error ? error.message : String(error));
  }
}
