# Edge Functions

Deno functions that run as the signed-in user (ADR 0004). `deno.json` is the shared import map: it maps the workspace packages to their sources and npm packages to the versions in `pnpm-lock.yaml`; keep those in step when a dependency is bumped. Each function names it as `import_map` in `supabase/config.toml`, which also makes the CLI mount and bundle the package sources. `tsconfig.json` mirrors the map for `pnpm typecheck` (run from `packages/data-supabase`).

## `ai-pass`

Runs any pass in `allPasses` (`packages/ai-passes/src/passes.ts`) and stores suggestions (ADR 0007). Request and response shapes are in `packages/data-supabase/src/ai-pass.ts`; clients call it through `SuggestionRepository`.

- `run`: write access to the project and floor, then the provider and model (`planModels` in `@el-karta/ai-passes`), then the per-user limit (runs in the last hour, counted by `my_ai_run_count`), then `runPass` with one `ai_runs` row per attempt. A pass runs on its `defaultModels` primary (Claude Haiku) and, when that provider fails after its own retries (`status` `error` or `rate_limited`: 5xx, timeout, 429), once more on its fallback (Gemini); invalid output never falls back. Each attempt is a logged run and counts towards the limit; the response carries the last one. A choice whose provider has no key is skipped, and a pass with no configured provider is refused (`bad_request`). A request may name `model: { provider, model }`, which then runs alone and only on a configured provider. A refusal (`AiPassErrorBody`) is not logged and does not count.
- `commit`: payloads are parsed by their kind (core `createSuggestionKinds`) and stored parsed; `requires` must point into the same commit or at a stored suggestion on the floor; `source` must start with `ai:<pass>:`; `runIds` must be runs of that floor and pass. A row keeps its `run_id` only when the commit names exactly one run.
- Bodies are capped at 4 MB while they are read, also without a `Content-Length`. Runs are logged without the project or floor once those are deleted, so deleting them never resets the limit.

Environment: `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` (Supabase secrets, never in a file here; every provider with a key is available), `AI_PROVIDER` (unset for every keyed provider; `anthropic` or `gemini` to use only that one; `fake` to answer every pass from `AI_FAKE_REPLIES`, a JSON array), `AI_RUNS_PER_HOUR` (a positive integer; anything else means the default, 30). With `fake`, a `test-echo` pass is also registered for the integration tests. A hosted project that still has `AI_PROVIDER=gemini` set stays on Gemini: unset it to make Haiku the primary.

Unit tests (`handler.test.ts`) run in the `functions` Vitest project, which resolves the import map's workspace packages through aliases in `vitest.config.ts`.

Local run for `pnpm test:integration`:

```sh
pnpm supabase functions serve --env-file packages/data-supabase/test/ai-pass.env
```
