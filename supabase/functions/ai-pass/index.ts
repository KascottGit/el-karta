import { allPasses, createPassRegistry } from '@el-karta/ai-passes';
import { createSuggestionKinds } from '@el-karta/core';
import type { Database } from '@el-karta/data-supabase';
import { createClient } from '@supabase/supabase-js';
import { createAiPassHandler } from './handler.ts';
import { testEchoPass } from './test-pass.ts';

declare const Deno: {
  env: { toObject(): Record<string, string> };
  serve(handler: (request: Request) => Promise<Response>): unknown;
};

const env: Record<string, string | undefined> = Deno.env.toObject();
const url = env['SUPABASE_URL'];
const anonKey = env['SUPABASE_ANON_KEY'];
if (!url || !anonKey) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');

Deno.serve(
  createAiPassHandler({
    env,
    passes: createPassRegistry(
      env['AI_PROVIDER'] === 'fake' ? [...allPasses, testEchoPass] : allPasses,
    ),
    kinds: createSuggestionKinds(),
    clientFor: (authorization) =>
      createClient<Database>(url, anonKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
  }),
);
