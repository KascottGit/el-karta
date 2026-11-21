import type { Id, Suggestion, SuggestionStatus } from '@el-karta/core';

/** Where the editor reads a floor's suggestions and records decisions on them. */
export interface SuggestionSource {
  /** Part of the query key, so switching sources never shows another source's rows. */
  readonly id: string;
  /** Every suggestion of the floor, whatever its status, since requirements may already be decided. */
  list(floorId: Id): Promise<Suggestion[]>;
  setStatus(ids: readonly Id[], status: SuggestionStatus): Promise<void>;
}

export interface MemorySource extends SuggestionSource {
  /** Makes the next `count` status changes fail, to test what the editor does then. */
  failNextStatus(count?: number): void;
  rows(): Suggestion[];
}

/**
 * Suggestions kept in memory, for unit tests, e2e tests and the dev synthetic page. `seed` fills a
 * floor the first time it is listed.
 */
export function createMemorySource(
  options: {
    id?: string;
    initial?: readonly Suggestion[];
    seed?: (floorId: Id) => readonly Suggestion[];
  } = {},
): MemorySource {
  const rows = new Map<Id, Suggestion>((options.initial ?? []).map((s) => [s.id, s]));
  const seeded = new Set<Id>();
  let failing = 0;
  return {
    id: options.id ?? 'memory',
    list(floorId) {
      if (options.seed && !seeded.has(floorId)) {
        seeded.add(floorId);
        for (const s of options.seed(floorId)) rows.set(s.id, s);
      }
      return Promise.resolve([...rows.values()].filter((s) => s.floorId === floorId));
    },
    setStatus(ids, status) {
      if (failing > 0) {
        failing--;
        return Promise.reject(new Error('The memory source was told to fail'));
      }
      const missing = ids.filter((id) => !rows.has(id));
      if (missing.length > 0) {
        return Promise.reject(new Error(`Unknown suggestions ${missing.join(', ')}`));
      }
      for (const id of ids) rows.set(id, { ...rows.get(id)!, status });
      return Promise.resolve();
    },
    failNextStatus(count = 1) {
      failing = count;
    },
    rows: () => [...rows.values()],
  };
}
