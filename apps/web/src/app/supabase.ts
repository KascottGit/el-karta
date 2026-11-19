import type { Database } from '@el-karta/data-supabase';
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
if (!url || !anonKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see .env.example).');
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
});

/** Where magic links return to: the app root under the deployed base path. */
export const authRedirectUrl = () => new URL(import.meta.env.BASE_URL, window.location.origin).href;
