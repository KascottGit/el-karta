import type {
  AiCommitRequest,
  AiCommitResponse,
  AiRunRequest,
  AiRunResponse,
} from '@el-karta/data-supabase';
import { loadSuggestionRepository } from '@/features/suggestions/supabase-source';

/** The `ai-pass` function's two actions (ADR 0007): run one pass on one image, store suggestions. */
export interface AiImportBackend {
  run(request: Omit<AiRunRequest, 'action'>, signal: AbortSignal): Promise<AiRunResponse>;
  commit(request: Omit<AiCommitRequest, 'action'>): Promise<AiCommitResponse>;
}

export const supabaseBackend: AiImportBackend = {
  run: async (request, signal) => (await loadSuggestionRepository()).runPass(request, { signal }),
  commit: async (request) => (await loadSuggestionRepository()).commitSuggestions(request),
};
