import {
  acceptSuggestions,
  createSuggestionKinds,
  type Id,
  type Suggestion,
  type SuggestionStatus,
} from '@el-karta/core';
import type { QueryClient } from '@tanstack/react-query';
import type { MessageKey } from '@/features/floorplan/canvas/extension';
import type { SelectionItem } from '@/features/floorplan/canvas/selection';
import { modelStore } from '@/model/store';
import { parsePayload } from './ghosts';
import type { SuggestionSource } from './source';
import { suggestionsStore, type TrackedAccept } from './suggestions-store';
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

/**
 * Why a suggestion cannot be accepted, by its message: a requirement that was rejected or is
 * missing, or a kind that is not registered or a payload that does not fit it (here or in a
 * requirement). Null when it, and everything it requires, can be accepted.
 */
export function createBlockers(all: readonly Suggestion[]): (s: Suggestion) => MessageKey | null {
  const byId = new Map(all.map((s) => [s.id, s]));
  const memo = new Map<Id, MessageKey | null>();
  const visiting = new Set<Id>();
  const blocker = (s: Suggestion): MessageKey | null => {
    if (s.status === 'accepted') return null;
    if (s.status === 'rejected') return 'suggestions.errors.requirementRejected';
    const known = memo.get(s.id);
    if (known !== undefined) return known;
    if (visiting.has(s.id)) return 'suggestions.errors.unreadable';
    visiting.add(s.id);
    let found: MessageKey | null =
      parsePayload(suggestionKinds, s) === null ? 'suggestions.errors.unreadable' : null;
    for (const r of s.requires) {
      if (found) break;
      const required = byId.get(r);
      found = required ? blocker(required) : 'suggestions.errors.requirementMissing';
    }
    visiting.delete(s.id);
    memo.set(s.id, found);
    return found;
  };
  return blocker;
}

/** Pending suggestions that can be accepted with everything they require: what "accept all" takes. */
export function acceptableIds(all: readonly Suggestion[]): Id[] {
  const blocker = createBlockers(all);
  return all.filter((s) => isPending(s) && blocker(s) === null).map((s) => s.id);
}

/** Transitive closure of `ids` over `requires`, as suggestions; missing ids are left out. */
function closure(all: readonly Suggestion[], ids: readonly Id[]): Suggestion[] {
  const byId = new Map(all.map((s) => [s.id, s]));
  const seen = new Set<Id>();
  const out: Suggestion[] = [];
  const visit = (id: Id) => {
    const s = byId.get(id);
    if (!s || seen.has(id)) return;
    seen.add(id);
    out.push(s);
    for (const r of s.requires) visit(r);
  };
  for (const id of ids) visit(id);
  return out;
}

/** The pending suggestions accepting `ids` pulls in besides them. */
export function requirementsOf(all: readonly Suggestion[], ids: readonly Id[]): Id[] {
  const asked = new Set(ids);
  return closure(all, ids)
    .filter((s) => isPending(s) && !asked.has(s.id))
    .map((s) => s.id);
}

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
 * Acceptable pending suggestions with a confidence of at least `threshold` whose pending
 * requirements also reach it, so a bulk accept never pulls in a less certain scale or wall.
 */
export function confidentIds(all: readonly Suggestion[], threshold: number): Id[] {
  const blocker = createBlockers(all);
  return all
    .filter(
      (s) =>
        isPending(s) &&
        blocker(s) === null &&
        closure(all, [s.id]).every((r) => !isPending(r) || (r.confidence ?? 0) >= threshold),
    )
    .map((s) => s.id);
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

/** Records a decision, showing it at once and going back to `previous` if the source refuses it. */
async function record(
  deps: SuggestionDeps,
  floorId: Id,
  ids: readonly Id[],
  status: SuggestionStatus,
  previous: SuggestionStatus = 'pending',
) {
  const set = new Set(ids);
  await deps.queries.cancelQueries({ queryKey: suggestionsKey(deps.source.id, floorId) });
  setCached(deps, floorId, set, status);
  try {
    await deps.source.setStatus(ids, status);
    return true;
  } catch {
    setCached(deps, floorId, set, previous);
    return false;
  }
}

const cached = ({ source, queries }: SuggestionDeps, floorId: Id) =>
  queries.getQueryData<Suggestion[]>(suggestionsKey(source.id, floorId)) ?? [];

let watching = false;

/**
 * Follows the model store's history: when an accept's entry is undone (it moves from `past` to
 * `future`) its rows go back to pending, so the ghosts return; when it is redone they are accepted
 * again. An entry that leaves the history otherwise (a new edit after undo, the history limit,
 * another project) is forgotten.
 */
function watchHistory() {
  if (watching) return;
  watching = true;
  modelStore.subscribe((s, prev) => {
    if (s.past === prev.past && s.future === prev.future) return;
    const { accepts } = suggestionsStore.getState();
    if (accepts.length === 0) return;
    const kept: TrackedAccept[] = [];
    for (const a of accepts) {
      const inPast = s.past.includes(a.entry);
      const inFuture = s.future.includes(a.entry);
      if (inFuture && prev.past.includes(a.entry)) {
        void record(a.deps, a.floorId, a.ids, 'pending', 'accepted');
      } else if (inPast && prev.future.includes(a.entry)) {
        void record(a.deps, a.floorId, a.ids, 'accepted', 'pending');
      }
      if (inPast || inFuture) kept.push(a);
    }
    if (kept.length !== accepts.length) suggestionsStore.setState({ accepts: kept });
  });
}

const untrack = (accept: TrackedAccept) => {
  suggestionsStore.setState((s) => ({ accepts: s.accepts.filter((a) => a !== accept) }));
};

/**
 * Accepts `ids` and everything they require as one model edit (one undo step), then marks those
 * rows accepted. Undo and redo of that step set the rows pending and accepted again
 * (`watchHistory`). If marking fails the edit stays and the rows stay pending; accepting them
 * again puts the same items by id, so nothing is duplicated.
 */
export async function acceptIds(
  deps: SuggestionDeps,
  floorId: Id,
  ids: readonly Id[],
): Promise<Decision> {
  if (ids.length === 0) return { ok: true, ids: [] };
  const all = cached(deps, floorId);
  const blocker = createBlockers(all);
  for (const id of ids) {
    const s = all.find((x) => x.id === id);
    const error = s ? blocker(s) : 'suggestions.errors.requirementMissing';
    if (error) return { ok: false, error, applied: false };
  }

  let accepted: Suggestion[];
  let tracked: TrackedAccept | null = null;
  try {
    const plan = acceptSuggestions(suggestionKinds, all, ids);
    const model = modelStore.getState();
    const last = model.past.at(-1);
    model.apply(plan.edit);
    accepted = plan.accepted;
    const entry = modelStore.getState().past.at(-1);
    if (entry && entry !== last) {
      watchHistory();
      tracked = { entry, floorId, ids: accepted.map((s) => s.id), deps };
      suggestionsStore.setState((s) => ({ accepts: [...s.accepts, tracked!] }));
    }
  } catch {
    return { ok: false, error: 'suggestions.errors.invalid', applied: false };
  }
  const acceptedIds = accepted.map((s) => s.id);
  if (await record(deps, floorId, acceptedIds, 'accepted')) return { ok: true, ids: acceptedIds };
  if (tracked) untrack(tracked);
  return { ok: false, error: 'suggestions.errors.saveAccepted', applied: true };
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
