import { ProviderError, type AiProvider, type GenerateRequest } from './provider.ts';

export interface FakeProvider extends AiProvider {
  readonly calls: GenerateRequest[];
}

/**
 * Replays `replies` in order (the last one repeats). A reply is JSON-encoded unless it is a string,
 * so tests can also send text that does not parse; a `ProviderError` is thrown instead.
 */
export function createFakeProvider(replies: readonly unknown[]): FakeProvider {
  if (replies.length === 0) throw new Error('A fake provider needs at least one reply');
  const calls: GenerateRequest[] = [];
  return {
    id: 'fake',
    calls,
    generateStructured(request) {
      const reply = replies[Math.min(calls.length, replies.length - 1)];
      calls.push(request);
      if (reply instanceof ProviderError) return Promise.reject(reply);
      const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
      return Promise.resolve({ text, modelVersion: `fake:${request.model}`, usage: {} });
    },
  };
}
