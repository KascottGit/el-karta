import type {
  AiCommitRequest,
  AiCommitResponse,
  AiRunRequest,
  AiRunResponse,
  SuggestionRepository,
} from '@el-karta/data-supabase';

/** The `ai-pass` function's two actions (ADR 0007): run one pass on one image, store suggestions. */
export interface AiImportBackend {
  run(request: Omit<AiRunRequest, 'action'>): Promise<AiRunResponse>;
  commit(request: Omit<AiCommitRequest, 'action'>): Promise<AiCommitResponse>;
}

let repository: Promise<SuggestionRepository> | undefined;

// Loaded on first use, so the editor's extensions can be imported without a Supabase client, as
// unit tests and the synthetic dev page do.
const load = () =>
  (repository ??= Promise.all([import('@el-karta/data-supabase'), import('@/app/supabase')]).then(
    ([{ SuggestionRepository }, { supabase }]) => new SuggestionRepository(supabase),
  ));

export const supabaseBackend: AiImportBackend = {
  run: async (request) => (await load()).runPass(request),
  commit: async (request) => (await load()).commitSuggestions(request),
};
