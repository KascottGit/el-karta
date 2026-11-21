import type { AnyAiPass } from './pass.ts';

export interface PassRegistry {
  get(id: string): AnyAiPass | undefined;
  ids(): string[];
}

export function createPassRegistry(passes: readonly AnyAiPass[]): PassRegistry {
  const map = new Map<string, AnyAiPass>();
  for (const pass of passes) {
    if (map.has(pass.id)) throw new Error(`Duplicate AI pass: ${pass.id}`);
    map.set(pass.id, pass);
  }
  return { get: (id) => map.get(id), ids: () => [...map.keys()] };
}
