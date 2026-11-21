# Edge Functions

Deno functions that run as the signed-in user (ADR 0004). `deno.json` is the shared import map: it maps the workspace packages to their sources and npm packages to the versions in `pnpm-lock.yaml`; keep those in step when a dependency is bumped. Each function names it as `import_map` in `supabase/config.toml`, which also makes the CLI mount and bundle the package sources. `tsconfig.json` mirrors the map for `pnpm typecheck` (run from `packages/data-supabase`).

## `ai-pass`

Runs any pass in `allPasses` (`packages/ai-passes/src/passes.ts`) and stores suggestions (ADR 0007). Request and response shapes are in `packages/data-supabase/src/ai-pass.ts`; clients call it through `SuggestionRepository`.

- `run`: write access to the project and floor, then the per-user limit (runs in the last hour, counted by `my_ai_run_count`), then `runPass`, then one `ai_runs` row. A provider failure is still a logged run with `status` `error` or `rate_limited`; a refusal (`AiPassErrorBody`) is not logged and does not count.
- `commit`: payloads are parsed by their kind (core `createSuggestionKinds`) and stored parsed; `requires` must point into the same commit or at a stored suggestion on the floor; `source` must start with `ai:<pass>:`; `runIds` must be runs of that floor and pass. A row keeps its `run_id` only when the commit names exactly one run.
- Bodies are capped at 4 MB.

Environment: `AI_PROVIDER` (`gemini` or `fake`), `GEMINI_API_KEY` (a Supabase secret, never in a file here), `AI_RUNS_PER_HOUR` (default 30), `AI_FAKE_REPLIES` (JSON array, with `AI_PROVIDER=fake`). With `fake`, a `test-echo` pass is also registered for the integration tests.

Local run for `pnpm test:integration`:

```sh
pnpm supabase functions serve --env-file packages/data-supabase/test/ai-pass.env
```
