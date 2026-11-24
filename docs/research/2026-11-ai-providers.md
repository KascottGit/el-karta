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

### Claude Haiku 5.5, checked 2026-11-23

Checked on Anthropic's models overview, the Haiku 5.5 model page, the pricing page and the structured outputs page (sources below), not through the Models API (no key yet):

- Model id `claude-haiku-5-5` (a pinned snapshot; the alias is the same string). Released 7 October 2026, retirement not before 7 October 2027. The older `claude-haiku-4-5` is still listed at $1 / $5.
- Prices per 1M tokens depend on the prompt length: up to 100,000 prompt tokens $0.10 in, $0.50 out, cache reads $0.01, 5-minute cache writes $0.125; over 100,000 prompt tokens $0.50 in, $2.50 out. The prompt length counts all input tokens, cached ones included. Batch API is half price. A floor-plan call is far below the threshold.
- Text and image input, 1M context, 128K output. Adaptive thinking is on by default (effort default `medium`); thinking tokens are billed as output. `temperature`, `top_p` and `top_k` must be left out.
- Structured output (`output_config.format`, JSON Schema) is supported. Objects must have `additionalProperties: false`; numeric bounds, string lengths and `oneOf` are not supported, which the provider handles with the SDK's schema transform.
- Same newer tokenizer as Claude 4.7 and later: about 30 % more tokens than Haiku 4.5 for the same text, so measure real counts.

### Anthropic API terms, checked 2026-11-23

Against PLAN.md "Data and provider terms":

- **Training:** inputs and outputs of the commercial API are not used for training by default; only data the customer explicitly reports as feedback or opts in.
- **DPA:** under the Commercial Terms Anthropic is the processor and the customer the controller. The DPA is part of the Commercial Terms; check the current version (and its SCCs for transfers out of the EEA) before customer data.
- **Retention:** prompts and outputs are not retained by default (Covered Models such as Fable and Mythos need 30 days; Haiku 5.5 is not one). Structured outputs cache only the JSON schema, for up to 24 hours. Flagged content may be kept up to 2 years. Zero data retention is available on request through sales.
- **Where data is processed:** `inference_geo` is `"global"` (default: US, Europe, Asia or Australia) or `"us"` (1.1x price). There is **no EU-only inference**, and workspace data at rest is stored in the US only. So the first-party API does not meet "ideally processing in the EEA".
- **EU option if needed:** Claude Haiku on Google Cloud (Google managed, Vertex AI EU regions) or Amazon Bedrock EU regions, where the cloud provider is the processor. It would be one more `AiProvider` (`@anthropic-ai/vertex-sdk` or the Bedrock client) behind the same interface. Prices and Haiku 5.5's availability in those EU regions need checking first.

Conclusion: fine for test data now. Before customer data, decide between the first-party API (US storage, DPA with SCCs) and an EU-region cloud deployment.

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
- Anthropic data retention: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- Anthropic data residency: https://platform.claude.com/docs/en/manage-claude/data-residency
- Anthropic server locations: https://privacy.claude.com/en/articles/7996890-where-are-your-servers-located-do-you-host-your-models-on-eu-servers
- Anthropic training on commercial data: https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training
- Anthropic as processor: https://privacy.claude.com/en/articles/9267385-does-anthropic-act-as-a-data-processor-or-controller
- Claude models overview: https://platform.claude.com/docs/en/about-claude/models/overview
- Claude pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Claude structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Gemini Flash-Lite EU pricing: https://www.requesty.ai/models/vertex/gemini-3.1-flash-lite-eu
- GPT-5 mini: https://developers.openai.com/api/docs/models/gpt-5-mini
- Mistral pricing: https://www.cloudzero.com/blog/mistral-api-pricing/
- Qwen pricing: https://ai-api-hub.com/providers/alibaba/models/alibaba-qwen3-vl-plus/
