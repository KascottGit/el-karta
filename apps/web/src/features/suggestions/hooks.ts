import type { Id, Suggestion } from '@el-karta/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { DEFAULT_TOOL, editorStore } from '@/features/floorplan/editor-store';
import { acceptIds, editTarget, rejectIds, suggestionsKey, type Decision } from './actions';
import { selectSuggestion, setNotice, suggestionsStore, useSuggestions } from './suggestions-store';

const NONE: readonly Suggestion[] = [];

/** Every suggestion of the floor, loaded once per visit; decisions update the cached list. */
export function useFloorSuggestions(floorId: Id) {
  const source = useSuggestions((s) => s.source);
  const { data, isError } = useQuery({
    queryKey: suggestionsKey(source.id, floorId),
    queryFn: () => source.list(floorId),
    staleTime: Infinity,
  });
  return { suggestions: data ?? NONE, failed: isError };
}

/** Accept and reject for the panel, reporting failures through the store's notice. */
export function useSuggestionActions(floorId: Id) {
  const queries = useQueryClient();
  return useMemo(() => {
    const deps = () => ({ source: suggestionsStore.getState().source, queries });
    const done = (decision: Decision) => {
      if (decision.ok) selectSuggestion(floorId, null);
      setNotice(floorId, decision.ok ? null : decision.error);
      return decision;
    };
    return {
      accept: async (ids: readonly Id[]) => done(await acceptIds(deps(), floorId, ids)),
      reject: async (ids: readonly Id[]) => done(await rejectIds(deps(), floorId, ids)),
      /** Accepts one suggestion and selects the item it became, with the select tool. */
      acceptAndEdit: async (suggestion: Suggestion) => {
        const decision = done(await acceptIds(deps(), floorId, [suggestion.id]));
        const target = editTarget(suggestion);
        if (decision.ok && target) {
          const editor = editorStore.getState();
          editor.setTool(DEFAULT_TOOL);
          editor.select([target]);
        }
        return decision;
      },
    };
  }, [floorId, queries]);
}
