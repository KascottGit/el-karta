import { createFakeProvider } from './fake.ts';
import { createGeminiProvider, type GeminiOptions } from './gemini.ts';
import type { AiProvider } from './provider.ts';

export interface ProviderFromEnvOptions {
  /** Replies for `AI_PROVIDER=fake`, usually a fixture the caller loaded. */
  fakeReplies?: readonly unknown[];
  fetch?: GeminiOptions['fetch'];
}

/** `AI_PROVIDER=fake` replays `fakeReplies`; otherwise `GEMINI_API_KEY` selects Gemini. */
export function createProviderFromEnv(
  env: Record<string, string | undefined>,
  options: ProviderFromEnvOptions = {},
): AiProvider {
  const kind = env['AI_PROVIDER'];
  if (kind === 'fake') return createFakeProvider(options.fakeReplies ?? []);
  if (kind !== undefined && kind !== 'gemini') throw new Error(`Unknown AI_PROVIDER: ${kind}`);
  const apiKey = env['GEMINI_API_KEY'];
  if (!apiKey) throw new Error('No AI provider configured: set GEMINI_API_KEY or AI_PROVIDER=fake');
  return createGeminiProvider({ apiKey, ...(options.fetch ? { fetch: options.fetch } : {}) });
}
