import {
  acceptSuggestions,
  createSuggestionKinds,
  SuggestionError,
  type Id,
  type Suggestion,
  type SuggestionStatus,
} from '@el-karta/core';
import type { QueryClient } from '@tanstack/react-query';
import type { MessageKey } from '@/features/floorplan/canvas/extension';
import type { SelectionItem } from '@/features/floorplan/canvas/selection';
import { modelStore } from '@/model/store';
import type { SuggestionSource } from './source';
import { suggestionView } from './views';

export const suggestionKinds = createSuggestionKinds();

/** Query key of a floor's suggestions; `['suggestions']` alone matches every floor and source. */
export const suggestionsKey = (sourceId: string, floorId: Id) =>
  ['suggestions', sourceId, floorId] as const;

export interface SuggestionDeps {
  source: SuggestionSource;
  queries: QueryClient;
}

export type Decision =
  | { ok: true; ids: Id[] }
  /** `applied`: the edit is in the model although the rows could not be marked. */
  | { ok: false; error: MessageKey; applied: boolean };

export const isPending = (s: Suggestion) => s.status === 'pending';

/** Pending suggestions that require any of `ids`, directly or through others, since they could never be accepted without them. */
export function dependantsOf(all: readonly Suggestion[], ids: readonly Id[]): Id[] {
  const out = new Set(ids);
  const found: Id[] = [];
  for (let grew = true; grew;) {
    grew = false;
    for (const s of all) {
      if (isPending(s) && !out.has(s.id) && s.requires.some((r) => out.has(r))) {
        out.add(s.id);
        found.push(s.id);
        grew = true;
      }
    }
  }
  return found;
}

/**
 * Pending suggestions with a confidence of at least `threshold` whose pending requirements also
 * reach it, so a bulk accept never pulls in a less certain scale or wall along with them.
 */
export function confidentIds(all: readonly Suggestion[], threshold: number): Id[] {
  const byId = new Map(all.map((s) => [s.id, s]));
  const memo = new Map<Id, boolean>();
  const confident = (s: Suggestion, seen: Set<Id>): boolean => {
    if (!isPending(s)) return s.status === 'accepted';
    const known = memo.get(s.id);
    if (known !== undefined) return known;
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    const ok =
      (s.confidence ?? 0) >= threshold &&
      s.requires.every((r) => {
        const required = byId.get(r);
        return required !== undefined && confident(required, seen);
      });
    memo.set(s.id, ok);
    return ok;
  };
  return all.filter((s) => isPending(s) && confident(s, new Set())).map((s) => s.id);
}

function setCached(
  { source, queries }: SuggestionDeps,
  floorId: Id,
  ids: ReadonlySet<Id>,
  status: SuggestionStatus,
) {
  queries.setQueryData<Suggestion[]>(suggestionsKey(source.id, floorId), (list) =>
    list?.map((s) => (ids.has(s.id) ? { ...s, status } : s)),
  );
}

/** Records a decision, showing it at once and taking it back if the source refuses it. */
async function record(deps: SuggestionDeps, floorId: Id, ids: Id[], status: SuggestionStatus) {
  const set = new Set(ids);
  await deps.queries.cancelQueries({ queryKey: suggestionsKey(deps.source.id, floorId) });
  setCached(deps, floorId, set, status);
  try {
    await deps.source.setStatus(ids, status);
    return true;
  } catch {
    setCached(deps, floorId, set, 'pending');
    return false;
  }
}

const cached = ({ source, queries }: SuggestionDeps, floorId: Id) =>
  queries.getQueryData<Suggestion[]>(suggestionsKey(source.id, floorId)) ?? [];

/**
 * Accepts `ids` and everything they require as one model edit (one undo step), then marks those
 * rows accepted. If marking fails the edit stays and the rows stay pending; accepting them again
 * puts the same items by id, so nothing is duplicated. Undoing the edit leaves the rows
 * accepted (see README).
 */
export async function acceptIds(
  deps: SuggestionDeps,
  floorId: Id,
  ids: readonly Id[],
): Promise<Decision> {
  if (ids.length === 0) return { ok: true, ids: [] };
  let accepted: Suggestion[];
  try {
    const plan = acceptSuggestions(suggestionKinds, cached(deps, floorId), ids);
    modelStore.getState().apply(plan.edit);
    accepted = plan.accepted;
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof SuggestionError
          ? 'suggestions.errors.requirementRejected'
          : 'suggestions.errors.invalid',
      applied: false,
    };
  }
  const acceptedIds = accepted.map((s) => s.id);
  return (await record(deps, floorId, acceptedIds, 'accepted'))
    ? { ok: true, ids: acceptedIds }
    : { ok: false, error: 'suggestions.errors.saveAccepted', applied: true };
}

/** Rejects `ids` and the pending suggestions that require them. The model is not touched. */
export async function rejectIds(
  deps: SuggestionDeps,
  floorId: Id,
  ids: readonly Id[],
): Promise<Decision> {
  const all = cached(deps, floorId);
  const pending = new Set(all.filter(isPending).map((s) => s.id));
  const rejected = [...ids, ...dependantsOf(all, ids)].filter((id) => pending.has(id));
  if (rejected.length === 0) return { ok: true, ids: [] };
  return (await record(deps, floorId, rejected, 'rejected'))
    ? { ok: true, ids: rejected }
    : { ok: false, error: 'suggestions.errors.saveRejected', applied: false };
}

/** The model item an accepted suggestion became, for "accept and edit"; null for floor-level values. */
export function editTarget(suggestion: Suggestion): SelectionItem | null {
  const collection = suggestionView(suggestion.kind).collection;
  const id = suggestionKinds.get(suggestion.kind)?.itemId(suggestion.payload) ?? null;
  return collection && id ? { collection, id } : null;
}
