# Cheap vision AI providers (November 2026)

Desk research before M11, to pick which providers to add behind `AiProvider` and run through the evals. Prices and terms change often: re-check the provider's own page before relying on a number. Nothing here is a decision; the evals decide (PLAN.md, "Evals").

## What we need

- Image input: floor plans (small printed text, dimension lines), phone photos of walls (M11), panel photos and breaker lists (M12).
- Structured output against a JSON Schema from Zod. Strict schema enforcement is nice to have, not required: `runPass` parses with Zod and retries once with the issues (ADR 0007).
- Paid tier with no training on our data, a DPA, and ideally processing in the EEA (PLAN.md, "Data and provider terms").
- Typical call: about 3 images and 3k tokens of text in, 3k tokens out (about 7.5k in, 3k out).

## Comparison

| Provider / model                                               | $/1M in            | $/1M out   | Est. per call | Structured output                           | Data terms                                                                                               |
| -------------------------------------------------------------- | ------------------ | ---------- | ------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Gemini 3 Flash (current default)                               | 0.50               | 3.00       | ~$0.013       | JSON Schema (`responseSchema`)              | Paid tier not used for training; EU residency via Vertex AI regions                                      |
| Gemini 3.1 Flash-Lite                                          | 0.25               | 1.50       | ~$0.006       | JSON Schema                                 | As above                                                                                                 |
| Claude Haiku 5.5 (`claude-haiku-5-5`, Oct 2026)                | 0.10               | 0.50       | ~$0.002       | Tool-use / structured outputs               | API data not used for training; also on Bedrock and Google Cloud (EU regions to verify)                  |
| Mistral Small 4 (vision)                                       | 0.15               | 0.60       | ~$0.003       | JSON Schema                                 | EU company, EU processing                                                                                |
| GPT-5 mini                                                     | 0.25               | 2.00       | ~$0.008       | Strict Structured Outputs                   | API data not used for training by default; EU residency not confirmed                                    |
| DeepSeek `deepseek-flash` (V4.1-Flash), official API           | 0.15–0.30          | 0.60–1.20  | ~$0.003–0.006 | JSON mode (valid JSON, schema not enforced) | Stored in the PRC; used for training unless you opt out by email; no DPA; Italian Garante ban (Jan 2025) |
| DeepSeek V4.1-Flash weights on an EU host (Scaleway, OVHcloud) | ~0.40 (unverified) | unverified | ~$0.004       | Depends on host                             | EU processing; the host's own terms need checking                                                        |
| Qwen3-VL-Plus (Alibaba, Singapore)                             | 0.20               | 1.60       | ~$0.006       | JSON (OpenAI-compatible)                    | No EU region found                                                                                       |

Verified against the provider's own docs: DeepSeek models, vision and prices; Claude Haiku 5.5 price and image input. The rest came from pricing aggregators and is directional.

## DeepSeek V4.1

Technically it fits: `deepseek-flash` takes images (resized to at most about 1024 tokens each), is among the cheapest options, and supports JSON output and tool calls. Peak hours are 01–04 and 06–10 UTC on weekdays; off-peak is half price.

For real customer data the official API does not fit an EU app: data is stored in China, API traffic is used for training by default, there is no DPA, and EU regulators have acted against it (Italy banned processing in January 2025; France, Ireland, Germany, Belgium and Portugal opened inquiries). Reliability is also weaker: about 99.5 % uptime from July to October 2026, including a five-hour outage on 15 October.

The weights are MIT-licensed, so the same model can run on an EU host. That is the only DeepSeek route worth evaluating, and the 1024-token cap per image needs testing on dense floor plans, where small text may not survive the downscale (tiling helps).

## Shortlist for the eval harness

1. **Gemini 3.1 Flash-Lite**: same SDK as today, half the price of Gemini 3 Flash. Cheapest change.
2. **Claude Haiku 5.5**: lowest price on the list from a provider with clear no-training terms; new tokenizer, so measure real token counts.
3. **Mistral Small 4**: EU company and EU processing, which simplifies GDPR.
4. **DeepSeek V4.1-Flash on an EU host**: only to measure what the lowest price costs in accuracy; test data only until the host's terms are checked.

Each needs an `AiProvider` implementation in `packages/ai-providers`. Score them on the floor-plan set first (it exists), then on the M11 photo set once it does, and record cost per call from `ai_runs`.

## Sources

- DeepSeek pricing: https://api-docs.deepseek.com/quick_start/pricing
- DeepSeek vision: https://api-docs.deepseek.com/guides/vision/
- DeepSeek outage, October 2026: https://dev.to/gabrielanhaia/deepseeks-api-was-partly-down-for-4h52m-its-refunding-a-week-of-spend-as-credit-3p6j
- Garante and DeepSeek: https://thedpo.eu/en/decisions/a8ad032c-f045-409e-a449-958de8c7374f
- DeepSeek on EU infrastructure: https://optinest.de/ai-infrastructure/models/open-weights/running-deepseek-models-on-european-infrastructure
- Claude Haiku 5.5: https://platform.claude.com/docs/en/models/haiku-5-5/overview
- Gemini Flash-Lite EU pricing: https://www.requesty.ai/models/vertex/gemini-3.1-flash-lite-eu
- GPT-5 mini: https://developers.openai.com/api/docs/models/gpt-5-mini
- Mistral pricing: https://www.cloudzero.com/blog/mistral-api-pricing/
- Qwen pricing: https://ai-api-hub.com/providers/alibaba/models/alibaba-qwen3-vl-plus/
