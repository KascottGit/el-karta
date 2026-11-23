# Provider review (before M11)

Status: **approved, in progress**. Milestone branch: `provider-review`.

From PLAN.md: Add `AiProvider` implementations for the shortlist in `docs/research/2026-11-ai-providers.md` (Gemini 3.1 Flash-Lite, Claude Haiku 5.5, Mistral Small 4, and DeepSeek V4.1-Flash on an EU host, never DeepSeek's own API with real data), with a provider switch in config and in `pnpm eval`. Run the floor-plan evals on each and record score, cost per call (from `ai_runs`), latency and failure rate. Check each provider's terms against "Data and provider terms".

**Done when:** the floor-plan eval results are recorded per provider and model, and an ADR names the default provider and model per pass and a fallback provider for outages.

**Changed scope (the person's decision, 2026-11-23):** Claude Haiku is the chosen provider. Mistral and DeepSeek are not added, and Gemini 3.1 Flash-Lite is not evaluated. The milestone adds the Anthropic provider, makes Haiku the default for every pass with Gemini as the fallback on outages, records Haiku's floor-plan eval next to the existing Gemini rows, and writes the ADR.

## Design decisions for this milestone

1. **A model choice is `{ provider, model }`.** This matches `ModelChoice` in the PLAN.md pass sketch. `defaultModels` in `packages/ai-passes/src/config.ts` becomes `Record<passId, { primary: ModelChoice; fallback?: ModelChoice }>`: Haiku as the primary, Gemini 3 Flash as the fallback. `ai_runs.provider` already exists, so the schema doesn't change.
2. **Anthropic provider** (`packages/ai-providers/src/anthropic.ts`) uses the official `@anthropic-ai/sdk` (runs in Node and Deno). It uses structured output through `output_config: { format: { type: 'json_schema', schema } }` and base64 image blocks. The model is the current Claude Haiku. The research doc calls it `claude-haiku-5-5` at $0.10/$0.50 per 1M tokens, but the Anthropic reference available here (cached June 2026) lists Haiku 4.5 at $1/$5. T1 checks the id and price against the Models API and the pricing page and records both in the research doc.
3. **Retries and timeouts are shared.** The backoff, retryable-status and timeout logic in `gemini.ts` moves into `retry.ts`, and both providers use it. The SDK's own retries are turned off (`maxRetries: 0`) so attempts are not multiplied.
4. **Configuration from the environment.** `createProvidersFromEnv(env)` returns every provider that has a key (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`), plus `fake` with `AI_PROVIDER=fake`. A pass whose primary provider has no key uses the fallback if that one has a key, and otherwise is refused clearly (`bad_request`).
5. **Fallback on outage.** The `ai-pass` function retries on the pass's `fallback` choice when the primary throws a `ProviderError` after its own retries (5xx, timeout, 429). Each attempt writes its own `ai_runs` row, so the failure rate stays visible. Invalid output is not an outage and never triggers the fallback. A request may still name a model, but only as a `ModelChoice` for a configured provider.
6. **Cost per call comes from a dated price table.** Evals call providers directly from Node and write no `ai_runs` rows. So cost is computed from token counts (the same numbers `ai_runs` stores) and `packages/ai-providers/src/prices.ts` (USD per 1M input/output tokens per provider and model, with the date checked and the source URL). The eval CSV gets `provider` and `costUsd` columns. `pnpm eval summary` groups `floorplan.csv` by provider, model and mode and writes `evals/results/floorplan-summary.md`: mean scores, mean cost per plan, median and p90 latency, and failure rate (`status != ok`). The ADR cites it.
7. **Dependency:** `@anthropic-ai/sdk` in `packages/ai-providers`, mapped in `supabase/functions/deno.json`.

## Shared building blocks

| Building block               | Location                             | Exists?                 | Used by |
| ---------------------------- | ------------------------------------ | ----------------------- | ------- |
| Retry/backoff/timeout helper | `packages/ai-providers/src/retry.ts` | in `gemini.ts`, extract | T1      |

T0 builds it.

## Tasks

Common acceptance for every task:

- `pnpm typecheck && pnpm lint && pnpm test` pass.
- New logic has unit tests (providers are tested with an injected `fetch`, with no network).
- No API key is ever logged, printed or written to results.
- The implementer's pre-finish checklist (`.claude/agents/implementer.md`) is done.

### T0 – Setup (orchestrator)

- Add `@anthropic-ai/sdk` and the `deno.json` mapping. Extract `retry.ts` from `gemini.ts` (behaviour unchanged, existing tests green).

### T1 – Anthropic provider and provider switch

- **Depends on:** T0
- **Touches:** `packages/ai-providers/src/*` (new `anthropic.ts`, `env.ts`, `index.ts`) and tests, `packages/ai-passes/src/config.ts`, `supabase/functions/ai-pass/*`, `supabase/functions/README.md`, `packages/data-supabase/src/ai-pass.ts`, `evals/run.ts`, `evals/floorplan/run.ts`, `evals/floorplan/README.md`, `docs/research/2026-11-ai-providers.md` (verified Haiku id and price).
- **Read:** ADR 0007, `supabase/functions/README.md`, `evals/floorplan/README.md`, this file.
- **Goal:** decisions 1–5. `pnpm eval floorplan --provider <id> --model <id>`. The runner takes each provider's key from the shell or from `supabase/functions/.env` (only the provider key names, as today).
- **Acceptance:** the Anthropic provider puts images in the first user message, maps `usage` (cache tokens counted as input), turns 429 into `rate_limited`, retries 503 and timeouts, turns `stop_reason: refusal`, `max_tokens` and empty output into `ProviderError`, and reports the response `model` as `modelVersion`. Handler tests cover: the primary fails and the fallback succeeds (two `ai_runs` rows); invalid output does not trigger the fallback; a missing primary key goes to the fallback; no key at all is refused; a request-named model for an unconfigured provider is refused. Integration tests still pass with `AI_PROVIDER=fake`.

### T2 – Cost and summary

- **Depends on:** T1
- **Touches:** `packages/ai-providers/src/prices.ts`, `evals/csv.ts`, `evals/floorplan/*`, a new `evals/summary.ts`, `evals/run.ts`, `evals/floorplan/README.md`.
- **Goal:** decision 6. Existing CSV rows read as `provider = gemini`, with cost computed from the table.
- **Acceptance:** unit tests for cost, grouping, percentiles and failure rate. `pnpm eval summary` on the committed CSV writes a correct table.

### T3 – Terms, eval run, ADR (orchestrator, with the person)

- Check Anthropic's current terms (no training on API data, DPA, EEA processing and retention) and record them with the date in the research doc.
- The person adds `ANTHROPIC_API_KEY` to `supabase/functions/.env` (and as a Supabase secret for el-karta-dev).
- Run `pnpm eval floorplan --provider anthropic` in printed and estimate mode, then `pnpm eval summary`.
- Write ADR 0010 "AI provider and model per pass": Haiku as the default, Gemini as the fallback, and the numbers and terms behind them. Update PLAN.md (the decision, provider review done).

## Order and parallelism

One agent at a time (ADR 0005 amendment): T0 → T1 → T2 → T3.
