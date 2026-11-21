import {
  createEmptyProject,
  type Id,
  type Opening,
  type Room,
  type Suggestion,
  type Wall,
} from '@el-karta/core';
import { QueryClient } from '@tanstack/react-query';
import { modelStore } from '@/model/store';
import { suggestionsKey, type SuggestionDeps } from './actions';
import { demoSuggestions } from './dev-seed';
import { createMemorySource } from './source';

/**
 * An empty project in the model store with the demo suggestions (`dev-seed.ts`) on its floor, in
 * a memory source whose list is already in a fresh query cache.
 */
export async function loadDemo() {
  const model = createEmptyProject({
    id: () => crypto.randomUUID(),
    name: 'Test',
    kind: 'home',
    buildingName: 'Hus',
    floorName: 'Plan 1',
  });
  const floorId = Object.keys(model.floors)[0]!;
  modelStore.getState().load(model, { discardUnsaved: true });
  const suggestions = demoSuggestions(model.floors[floorId]!, model.project.id);
  const source = createMemorySource({ initial: suggestions });
  const queries = new QueryClient();
  queries.setQueryData(suggestionsKey(source.id, floorId), await source.list(floorId));
  const deps: SuggestionDeps = { source, queries };

  const byKind = (kind: string) => suggestions.filter((s) => s.kind === kind);
  return {
    floorId,
    source,
    queries,
    deps,
    suggestions,
    byKind,
    wall: (s: Suggestion) => s.payload as Wall,
    opening: (s: Suggestion) => s.payload as Opening,
    room: (s: Suggestion) => s.payload as Room,
    floor: () => modelStore.getState().model!.floors[floorId]!,
    cached: () => queries.getQueryData<Suggestion[]>(suggestionsKey(source.id, floorId))!,
    status: (id: Id) => source.rows().find((s) => s.id === id)?.status,
  };
}
