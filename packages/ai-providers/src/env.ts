import { createAnthropicProvider } from './anthropic.ts';
import { createFakeProvider } from './fake.ts';
import { createGeminiProvider } from './gemini.ts';
import type { AiProvider } from './provider.ts';

/** The environment variable that holds each real provider's API key. */
export const providerKeys = {
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
} as const satisfies Record<string, string>;

export type RealProviderId = keyof typeof providerKeys;

const create: Record<RealProviderId, (apiKey: string) => AiProvider> = {
  anthropic: (apiKey) => createAnthropicProvider({ apiKey }),
  gemini: (apiKey) => createGeminiProvider({ apiKey }),
};

const isRealProvider = (id: string): id is RealProviderId => Object.hasOwn(providerKeys, id);

export interface ProvidersFromEnvOptions {
  /** Replies for `AI_PROVIDER=fake`, usually a fixture the caller loaded. */
  fakeReplies?: readonly unknown[];
}

/**
 * Every provider that has its key in `env`, by id. `AI_PROVIDER=fake` gives only the fake
 * provider, replaying `fakeReplies`; `AI_PROVIDER=<id>` keeps only that provider.
 */
export function createProvidersFromEnv(
  env: Record<string, string | undefined>,
  options: ProvidersFromEnvOptions = {},
): ReadonlyMap<string, AiProvider> {
  const only = env['AI_PROVIDER'] || undefined;
  if (only === 'fake') return new Map([['fake', createFakeProvider(options.fakeReplies ?? [])]]);
  if (only !== undefined && !isRealProvider(only)) throw new Error(`Unknown AI_PROVIDER: ${only}`);
  const providers = new Map<string, AiProvider>();
  for (const id of Object.keys(providerKeys).filter(isRealProvider)) {
    const apiKey = env[providerKeys[id]];
    if (apiKey && (only === undefined || only === id)) providers.set(id, create[id](apiKey));
  }
  return providers;
}
