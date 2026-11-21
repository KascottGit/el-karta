# Suggestions

Reviewing what AI passes (and later rules) propose for a floor, before any of it becomes model data (ADR 0007, PLAN.md principle 6). It is a floor-editor extension (`extension.ts`, registered in `features/floorplan/extensions.ts`); see `features/floorplan/README.md` for how extensions work.

## Pieces

- **Source** (`source.ts`): `SuggestionSource` lists a floor's suggestions (every status, since requirements may already be decided) and sets statuses. `supabase-source.ts` uses `SuggestionRepository`; `createMemorySource` keeps them in memory for tests. The active source is in `suggestionsStore` (`setSuggestionSource` switches it). The list is loaded with TanStack Query under `suggestionsKey(source.id, floorId)`, once per visit; decisions update the cached list. Whoever stores new suggestions (the import flow) invalidates `['suggestions']`.
- **Views** (`views.ts`): how each kind is shown: its group title and order, the collection the accepted item lands in, a ghost shape, a one-line description. Payloads are parsed with the kind's schema from the core registry first. A new kind (devices, connections) needs a core `SuggestionKindDef` and a view here; a kind without a view is listed with a generic line and can still be decided on.
- **Layer** (`suggestions-layer.tsx`): ghosts of the pending suggestions on the `overlays` layer, culled by the render window like the model layers: walls as dashed lines of their thickness, openings as dashed spans over their wall (a floor wall or a suggested one), rooms and zones as translucent dashed polygons with their name. Colour is by confidence (`suggestionStyle` in `canvas/theme.ts`), an issue's colour (`issueColors`) when it has issues, and the selection colour when selected. Ghosts never enter the model, so `floorIssues` never sees them.
- **Tool** (`tool.ts`, "Granska förslag", A): shows the panel. A tap selects the ghost under it, hit-tested in plan coordinates (`ghostAt`: openings before walls before areas), because ghosts are not model items and so not `selectable` nodes. The layer publishes its ghosts to `suggestionsStore` for this. Another feature opens the review with `editorStore.getState().setTool(SUGGESTIONS_TOOL)`.
- **Panel** (`suggestions-panel.tsx`): the selected suggestion, floor-level values (scale, floor height), bulk actions, then one group per kind, each item with its confidence and issues (`issues.<code>`, with the issue's params).
- **Actions** (`actions.ts`), as pure functions over a source and a `QueryClient`, so they are tested without React.

## Decisions

- **Accepting** is `acceptSuggestions` from core: the suggestions plus their pending requirements become one `apply(edit)`, so one undo step, then their rows are marked accepted. If marking fails, the edit stays, the rows stay pending and the panel says so; accepting again puts the same items by id, so nothing is duplicated.
- **Undo does not change rows.** Undoing an accept removes the items from the model but leaves the rows accepted, so their ghosts do not come back. Draw the item again or re-run the pass if that was a mistake.
- **"Godkänn och redigera"** accepts one suggestion and selects the item it became with the select tool (`editTarget`). Floor-level values have no item and only offer accept and reject.
- **Rejecting** a suggestion also rejects the pending suggestions that require it, directly or through others, since they could never be accepted. The panel asks first, with the count.
- **"Godkänn säkra"** accepts the pending suggestions at or above the threshold (default `suggestionStyle.thresholds.high`, 80 %) whose pending requirements reach it too, so a bulk accept never pulls in a less certain scale or wall. A suggestion without a confidence counts as below every threshold above 0.

## Dev and e2e

In development builds, `?suggestions` in the URL (e.g. `/dev/synthetic/small?suggestions`) uses a memory source seeded with `dev-seed.ts`: a scale, a floor height and a 4 × 3 m bedroom with a door and a window beside the floor's walls. `apps/web/e2e/suggestions.spec.ts` uses it.
