# Provider review (before M11)

Status: **draft, awaiting approval**. Milestone branch: `provider-review`.

From PLAN.md: Add `AiProvider` implementations for the shortlist in `docs/research/2026-11-ai-providers.md` (Gemini 3.1 Flash-Lite, Claude Haiku 5.5, Mistral Small 4, and DeepSeek V4.1-Flash on an EU host, never DeepSeek's own API with real data), with a provider switch in config and in `pnpm eval`. Run the floor-plan evals on each and record score, cost per call (from `ai_runs`), latency and failure rate. Check each provider's terms against "Data and provider terms".

**Done when:** the floor-plan eval results are recorded per provider and model, and an ADR names the default provider and model per pass and a fallback provider for outages.

## Design decisions for this milestone (approve with the plan)

1. **A model choice is `{ provider, model }`.** This matches `ModelChoice` in the PLAN.md pass sketch. `defaultModels` in `packages/ai-passes/src/config.ts` becomes `Record<passId, { primary: ModelChoice; fallback?: ModelChoice }>`. `ai_runs.provider` already exists, so the schema doesn't change.
2. **Three provider implementations, two of them new:**
   - `gemini` (exists): Gemini 3.1 Flash-Lite is only a model id and needs no code.
   - `anthropic`: the official `@anthropic-ai/sdk` (runs in Node and Deno). It uses structured output through `output_config: { format: { type: 'json_schema', schema } }` and base64 image blocks. The research doc calls the model `claude-haiku-5-5` at $0.10/$0.50, but the Anthropic reference available here (cached June 2026) lists Haiku 4.5 at $1/$5 as the cheapest model. T2 checks the id and price against the Models API and the pricing page before anything is recorded.
   - `openai-compatible`: one implementation using the official `openai` SDK with a `baseURL`. It covers **Mistral** (`https://api.mistral.ai/v1`, chat completions with `response_format: json_schema` and image URLs) and **DeepSeek V4.1-Flash on an EU host** (Scaleway Generative APIs or OVHcloud AI Endpoints, both OpenAI-compatible). This follows principle 3: two providers share one adapter instead of getting two SDKs. Each configured endpoint gets its own provider id (`mistral`, `deepseek-eu`), so `ai_runs` and the eval CSV can tell them apart. A host that only offers JSON mode without schema enforcement is acceptable: `runPass` parses with Zod and retries once.
   - DeepSeek's own API is never added.
3. **Retries and timeouts are shared.** The backoff, retryable-status and timeout logic in `gemini.ts` moves into `retry.ts`, and all providers use it. Each SDK's own retries are turned off so attempts are not multiplied.
4. **Configuration from the environment.** `createProvidersFromEnv(env)` returns every provider that has a key (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_EU_API_KEY` + `DEEPSEEK_EU_BASE_URL`), plus `fake` with `AI_PROVIDER=fake`. A pass whose provider has no key is refused clearly (`bad_request`), not passed to another provider without notice.
5. **Fallback on outage.** The `ai-pass` function retries on the pass's `fallback` choice when the primary throws a `ProviderError` after its own retries (5xx, timeout, 429). Each attempt writes its own `ai_runs` row, so the failure rate stays visible. Invalid output is not an outage and never triggers the fallback. A request may still name a model, but only as a `ModelChoice` for a configured provider.
6. **Cost per call comes from a dated price table.** Evals call providers directly from Node and write no `ai_runs` rows. So cost is computed from token counts (the same numbers `ai_runs` stores) and `packages/ai-providers/src/prices.ts` (USD per 1M input/output tokens per provider and model, with the date checked and the source URL). The eval CSV gets `provider` and `costUsd` columns. A later SQL report over `ai_runs` can reuse the table. Deviation from PLAN.md's wording "(from `ai_runs`)": the numbers are the same, only the place they are read from differs.
7. **`pnpm eval summary`** groups `floorplan.csv` by provider, model and mode and writes `evals/results/floorplan-summary.md`: mean scores, mean and p90 cost per plan, median and p90 latency, and failure rate (`status != ok`). The ADR cites this file.
8. **Test data only.** The eval plans are public estate-agent plans, so every provider may see them, including the EU DeepSeek host before its terms are checked.
9. **Dependencies:** `@anthropic-ai/sdk` and `openai`, both in `packages/ai-providers` and both mapped in `supabase/functions/deno.json`. Nothing else.

## Shared building blocks

| Building block                               | Location                                    | Exists?                 | Used by    |
| -------------------------------------------- | ------------------------------------------- | ----------------------- | ---------- |
| Retry/backoff/timeout helper                 | `packages/ai-providers/src/retry.ts`        | in `gemini.ts`, extract | T1, T2, T3 |
| `ModelChoice` type and provider map from env | `packages/ai-providers/src/env.ts`          | partly (one provider)   | T1–T4      |
| Price table                                  | `packages/ai-providers/src/prices.ts`       | no                      | T4         |
| Provider conformance test (shared cases)     | `packages/ai-providers/test/conformance.ts` | no                      | T2, T3     |

T0 builds the retry helper, the `ModelChoice` type and the conformance test cases. Every provider must pass them: images end up in the first user message, usage is mapped, 429 becomes `rate_limited`, 503 is retried, empty or refused output becomes a `ProviderError`, and the timeout works.

## Tasks

Common acceptance for every task:

- `pnpm typecheck && pnpm lint && pnpm test` pass.
- New logic has unit tests (providers are tested with an injected `fetch`, with no network).
- No API key is ever logged, printed or written to results.
- The implementer's pre-finish checklist (`.claude/agents/implementer.md`) is done.

### T0 – Setup (orchestrator)

- Add the two dependencies and the `deno.json` mappings. Extract `retry.ts` from `gemini.ts` (behaviour unchanged, existing tests green). Add `ModelChoice` and the conformance test cases, and run Gemini against them.

### T1 – Provider switch: config, Edge Function, eval runner

- **Depends on:** T0
- **Touches:** `packages/ai-providers/src/env.ts`, `packages/ai-passes/src/config.ts`, `supabase/functions/ai-pass/*`, `packages/data-supabase/src/ai-pass.ts`, `evals/run.ts`, `evals/floorplan/run.ts`, READMEs of these.
- **Read:** ADR 0007, `supabase/functions/README.md`, `evals/floorplan/README.md`.
- **Goal:** decisions 1, 4 and 5. `pnpm eval floorplan --provider <id> --model <id>`. The runner takes each provider's key from the shell or from `supabase/functions/.env` (only the provider key names, as today).
- **Acceptance:** handler tests cover the primary failing → fallback succeeding (two `ai_runs` rows), invalid output → no fallback, a provider without a key → refusal, and a request-named model for an unconfigured provider → refusal. Integration tests still pass with `AI_PROVIDER=fake`.
- **Out of scope:** new providers, cost.

### T2 – Anthropic provider

- **Depends on:** T0 (can run before or after T1)
- **Touches:** `packages/ai-providers/src/anthropic.ts`, its test, `index.ts`.
- **Read:** ADR 0007, `docs/research/2026-11-ai-providers.md`.
- **Goal:** decision 2 with `@anthropic-ai/sdk`. Check the cheapest current Claude vision model id and price (Models API, pricing page) and note the result in the research doc.
- **Acceptance:** passes the conformance cases. `usage` maps input and output tokens (cache tokens included in input), `stop_reason: refusal` and `max_tokens` become `ProviderError`, and `modelVersion` is the response's `model`.

### T3 – OpenAI-compatible provider (Mistral, DeepSeek on an EU host)

- **Depends on:** T0
- **Touches:** `packages/ai-providers/src/openai-compatible.ts`, its test, `index.ts`.
- **Goal:** decision 2 with the `openai` SDK. Takes a provider id, `baseURL`, API key and whether the endpoint enforces JSON Schema (otherwise it uses `json_object` and puts the schema in the system prompt).
- **Acceptance:** passes the conformance cases in both schema modes. Images are sent as `data:` URLs.

### T4 – Cost and summary

- **Depends on:** T1, T2, T3
- **Touches:** `packages/ai-providers/src/prices.ts`, `evals/csv.ts`, `evals/floorplan/*`, a new `evals/summary.ts`, `evals/run.ts`, `evals/floorplan/README.md`.
- **Goal:** decisions 6 and 7. Existing CSV rows read as `provider = gemini` with an empty cost (or the cost computed from the table where the model is listed).
- **Acceptance:** unit tests for cost, grouping, percentiles and failure rate. `pnpm eval summary` on the committed CSV writes a correct table.

### T5 – Terms, eval runs, ADR (orchestrator, with the person)

- Check each provider's current terms (no training on API data, DPA, EEA processing, retention) and update the research doc with dates and links.
- The person adds the keys to `supabase/functions/.env` and approves the spend (estimated under $5 in total: 8 plans × ~2–4 calls × 5 provider/model pairs, printed and estimate mode).
- Run `pnpm eval floorplan` for Gemini 3 Flash (baseline), Gemini 3.1 Flash-Lite, Claude Haiku, Mistral Small 4 and DeepSeek V4.1-Flash (EU), then `pnpm eval summary`.
- Write ADR 0010 "AI provider and model per pass": default per pass, fallback provider, and why (scores, cost, latency, failure rate, terms). Update `config.ts` to match and update PLAN.md (mark done).

## Order and parallelism

One agent at a time (ADR 0005 amendment). Order: T0 → T1 → T2 → T3 → T4 → T5. T2 and T3 have disjoint Touches and could run in either order.
