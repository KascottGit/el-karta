# 0007 AI pipeline

Status: accepted (M4)

## Decision

- **Passes are registrations.** A pass (`packages/ai-passes`, `AiPass`) has an input schema, a prompt, an output schema, deterministic validators, an optional tile `merge` and `toSuggestions`. `runPass` does the same loop for every pass: prompt → `generateStructured` → Zod parse → validate → on errors, one retry with the issues → result with any remaining issues. The `ai-pass` Edge Function runs any registered pass; a new pass needs no new function. Differences from the PLAN.md sketch: the caller passes the relevant subset of the model as the pass input (instead of `selectContext(project, …)` loading it), and the function receives the image in the request, because the browser already has it for tiling.
- **Providers sit behind one interface** in `packages/ai-providers` (`AiProvider.generateStructured`), not in `supabase/functions/_shared/`, so the eval runner in Node and the Edge Function in Deno run the same code. Gemini uses the official `@google/genai` SDK. A fake provider replays fixtures for tests and for the local stack (`AI_PROVIDER=fake`). Providers return raw text; parsing belongs to the runner. JSON Schema for structured output comes from Zod 4's `z.toJSONSchema`.
- **The LLM reads, code measures.** Passes ask the model for what it sees in image coordinates (normalised 0–1000) and turn that into model geometry with core geometry code: snapping, merging, projection onto walls, `fillRoom`, scale from printed values or from objects of standard size.
- **Suggestions are rows, not model data.** The `suggestions` table holds each proposed item with its kind, payload, confidence, issues, the suggestions it requires and a status. Kinds are registered in core (`SuggestionKindDef`: payload schema, accept edit, model id); `acceptSuggestions` turns a selection plus its requirements into one undoable edit with `provenance.status = 'confirmed'` and the pass's source. Rejected suggestions never touch the model.
- **Large images are tiled in the browser** with overlap; each tile is one function call, and the pass's pure `merge` joins them, so no call runs near the Edge Function time limit.
- **Runs are logged and limited.** Every run writes `ai_runs` (pass, provider, model, tokens, images, retries, status, duration, error) as the user, and the function refuses a user's runs above a per-hour limit counted from that table.

## Why

PLAN.md principles 6–8: AI suggests and people confirm, the LLM handles meaning and code handles geometry, and guesses are never shown as facts. Keeping providers and passes in plain TypeScript packages lets the same code run in tests, evals, the browser (merge) and the Edge Function.
