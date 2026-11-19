import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/index.ts';

interface LocalStack {
  url: string;
  anonKey: string;
}

let stack: LocalStack | undefined;

/** Reads URL and anon key from the running local stack (`pnpm supabase start`). Never the service role. */
export function localStack(): LocalStack {
  if (stack) return stack;
  let raw: string;
  try {
    raw = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
      cwd: new URL('../../..', import.meta.url).pathname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error('Local Supabase is not running. Start it with `pnpm supabase start`.');
  }
  const status = JSON.parse(raw) as { API_URL: string; ANON_KEY: string };
  stack = { url: status.API_URL, anonKey: status.ANON_KEY };
  return stack;
}

/** A fresh user signed up with a password and signed in on their own client. */
export async function signedInUser(label: string) {
  const { url, anonKey } = localStack();
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `${label}-${randomUUID()}@test.local`;
  const { data, error } = await client.auth.signUp({ email, password: `pw-${randomUUID()}` });
  if (error || !data.user)
    throw new Error(`Sign-up failed for ${email}: ${error?.message ?? 'no user'}`);
  return { client, email, userId: data.user.id };
}
