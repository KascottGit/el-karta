import type { SuggestionRepository } from '@el-karta/data-supabase';
import type { SuggestionSource } from './source';

let repository: Promise<SuggestionRepository> | undefined;

// Loaded on first use, so the editor's extensions can be imported without a Supabase client, as
// unit tests and the synthetic dev page do.
const load = () =>
  (repository ??= Promise.all([import('@el-karta/data-supabase'), import('@/app/supabase')]).then(
    ([{ SuggestionRepository }, { supabase }]) => new SuggestionRepository(supabase),
  ));

/** The `suggestions` table, as the signed-in user (ADR 0007). */
export const supabaseSource: SuggestionSource = {
  id: 'supabase',
  list: async (floorId) => (await load()).listSuggestions(floorId),
  setStatus: async (ids, status) => {
    await (await load()).setStatus(ids, status);
  },
};
