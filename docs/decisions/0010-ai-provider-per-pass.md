# 0010 AI provider and model per pass

Status: accepted (provider review, 2026-11-24). Builds on ADR 0007.

## Decision

- **Default:** Claude Haiku 5.5 (`anthropic` / `claude-haiku-5-5`) for every pass (`floorplan-locate`, `floorplan`), set in `packages/ai-passes/src/config.ts`. The person chose Haiku before the eval; the eval below confirms it.
- **Fallback for outages:** Gemini 3 Flash (`gemini` / `gemini-3-flash-preview`). The `ai-pass` function switches only when the primary is unavailable or rate limited after its own retries, not on a bad request, a refusal or invalid output. One run has a 140 s budget (below the 150 s Edge Function limit); with a fallback the primary may use 70 s. Each attempt is its own `ai_runs` row, and the suggestions' `source` names the model that answered.
- **Only these two providers.** Mistral, DeepSeek on an EU host and Gemini 3.1 Flash-Lite from the research shortlist were not added (the person's decision). A new provider is one more `AiProvider` plus an entry in `providerKeys` and `modelPrices`.
- **Schema for Claude:** structured output compiles every inline copy of a sub-schema into its grammar, and the floor-plan schema was refused as too large. The Anthropic provider moves repeated object schemas into `$defs` (`shareRepeatedObjects`); passes keep writing plain Zod.
- **M11 onward:** the photo pass starts on the same default. Its eval runs on Haiku, plus Gemini 3 Flash as the fallback it would run on.

## Evidence

Floor-plan eval, 8 plans, one run per plan and mode (`evals/results/floorplan-summary.md`, 2026-11-24):

|                             | Haiku 5.5, printed | Haiku 5.5, estimate | Gemini 3 Flash, printed |
| --------------------------- | -----------------: | ------------------: | ----------------------: |
| Room names matched          |               0.74 |                0.47 |                    0.48 |
| Rooms found (≈4.3 expected) |                3.5 |                 3.0 |                     2.8 |
| Room types correct          |               0.81 |                1.00 |                    0.83 |
| Doors found (3.0 expected)  |                2.6 |                 2.5 |                     3.3 |
| Scale error (mean absolute) |              0.007 |               0.044 |                   0.214 |
| Scale estimate within 10 %  |                  – |                57 % |                       – |
| Mean cost per plan          |            $0.0040 |             $0.0038 |                 $0.0335 |
| Median / p90 duration       |        28 s / 35 s |         24 s / 34 s |             39 s / 59 s |
| Failure rate                |                0 % |                 0 % |                     0 % |

Haiku reads names, rooms and scale better than Gemini 3 Flash at about an eighth of the cost and is faster; it finds slightly fewer doors (Gemini overshoots). Eight plans and one run each is a small sample: rerun the eval when the plan set grows or the model changes.

## Terms (checked 2026-11-23, details in `docs/research/2026-11-ai-providers.md`)

- API data is not used for training; Anthropic is the processor under the Commercial Terms (DPA included); prompts and outputs are not retained by default for Haiku; zero data retention on request.
- **Data at rest is stored in the US, and inference is `global` or `us` only: there is no EU-only processing on the first-party API.** That is fine for test data. Before customer data, choose between the first-party API (with the DPA's transfer clauses) and Claude on Google Cloud Vertex AI or Amazon Bedrock in an EU region (one more `AiProvider`).
- Gemini as fallback: the free tier may use data for training, so the fallback key must be on a paid tier before customer data, as PLAN.md already requires.

## Why

PLAN.md "Evals": model choices are based on numbers. Haiku is cheapest per plan and best on the floor-plan scores that matter most (rooms, names, scale), and a second provider covers outages so imports don't fail when one vendor is down.
