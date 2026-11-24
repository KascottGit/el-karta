import Anthropic, { APIError, type ClientOptions } from '@anthropic-ai/sdk';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';
import { ProviderError, type AiProvider, type GenerateRequest, type Usage } from './provider.ts';
import { withRetries, type RetryOptions } from './retry.ts';

export interface AnthropicOptions extends RetryOptions {
  apiKey: string;
  fetch?: ClientOptions['fetch'];
}

/**
 * Room for adaptive thinking plus a floor plan's JSON (about 10k tokens). Requests this large must
 * stream (the SDK refuses non-streaming ones that may run past 10 minutes).
 */
const maxTokens = 64_000;

type RequestSignal = NonNullable<
  NonNullable<Parameters<Anthropic['messages']['stream']>[1]>['signal']
>;
type MediaType = Anthropic.Base64ImageSource['media_type'];
const mediaTypes = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Errors sent inside a stream carry no HTTP status, only a type.
const statusOfType: Partial<Record<string, number>> = {
  rate_limit_error: 429,
  overloaded_error: 529,
  api_error: 500,
  timeout_error: 504,
};

function statusOf(error: unknown): number | undefined {
  if (!(error instanceof APIError)) return undefined;
  const status: number | undefined = (error as APIError).status;
  return status ?? (error.type ? statusOfType[error.type] : undefined);
}

export function createAnthropicProvider(options: AnthropicOptions): AiProvider {
  // Retries happen in `withRetries`; the SDK's own would multiply the attempts.
  const client = new Anthropic({
    apiKey: options.apiKey,
    maxRetries: 0,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const call = (request: GenerateRequest) => {
    const params: Anthropic.MessageStreamParams = {
      model: request.model,
      max_tokens: maxTokens,
      system: request.system,
      messages: toMessages(request),
      output_config: {
        format: { type: 'json_schema', schema: toAnthropicSchema(request.jsonSchema) },
      },
    };
    return withRetries(
      (signal) =>
        client.messages.stream(params, { signal: signal as RequestSignal }).finalMessage(),
      {
        ...options,
        label: 'Claude',
        deadline: request.deadline,
        statusOf,
      },
    );
  };

  return {
    id: 'anthropic',
    async generateStructured(request) {
      const message = await call(request);
      if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
        throw new ProviderError(
          'error',
          `Claude stopped without an answer (${message.stop_reason})`,
        );
      }
      const text = message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      if (text === '') {
        throw new ProviderError(
          'error',
          `Claude returned no text (${message.stop_reason ?? 'no stop reason'})`,
        );
      }
      const u = message.usage;
      // Cached prompt tokens are input too; `input_tokens` counts only the uncached rest.
      const usage: Usage = {
        inputTokens:
          u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens,
      };
      return { text, usage, modelVersion: message.model };
    },
  };
}

/**
 * The schema structured output accepts: every object closed, and keywords it does not support
 * (bounds, lengths) moved into descriptions. `runPass` still checks the full schema with Zod.
 */
export function toAnthropicSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  return shareRepeatedObjects(transformJSONSchema(jsonSchema));
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const isObjectSchema = (node: Json): node is JsonObject =>
  typeof node === 'object' && node !== null && !Array.isArray(node) && node['type'] === 'object';

/**
 * Moves object schemas that occur more than once into `$defs` and refers to them. Structured output
 * compiles every inline copy into the grammar, and the floor-plan schema's dozen inline points
 * alone exceed its size limit ("The compiled grammar is too large").
 */
export function shareRepeatedObjects(schema: Record<string, unknown>): Record<string, unknown> {
  const root = schema as JsonObject;
  const counts = new Map<string, number>();
  const count = (node: Json, isRoot: boolean) => {
    if (Array.isArray(node))
      node.forEach((child) => {
        count(child, false);
      });
    else if (typeof node === 'object' && node !== null) {
      if (!isRoot && isObjectSchema(node)) {
        const key = JSON.stringify(node);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      Object.values(node).forEach((child) => {
        count(child, false);
      });
    }
  };
  count(root, true);

  const defs: JsonObject = {};
  const names = new Map<string, string>();
  const rewrite = (node: Json, isRoot: boolean): Json => {
    if (Array.isArray(node)) return node.map((child) => rewrite(child, false));
    if (typeof node !== 'object' || node === null) return node;
    const key = JSON.stringify(node);
    if (!isRoot && isObjectSchema(node) && (counts.get(key) ?? 0) > 1) {
      let name = names.get(key);
      if (name === undefined) {
        name = `shared${names.size + 1}`;
        names.set(key, name);
        defs[name] = rewriteChildren(node);
      }
      return { $ref: `#/$defs/${name}` };
    }
    return rewriteChildren(node);
  };
  const rewriteChildren = (node: JsonObject): JsonObject =>
    Object.fromEntries(Object.entries(node).map(([k, v]) => [k, rewrite(v, false)]));

  const result = rewrite(root, true) as JsonObject;
  if (names.size === 0) return result;
  const existing = result['$defs'];
  return { ...result, $defs: { ...(isPlainObject(existing) ? existing : {}), ...defs } };
}

const isPlainObject = (node: Json | undefined): node is JsonObject =>
  typeof node === 'object' && node !== null && !Array.isArray(node);

function toMessages(request: GenerateRequest): Anthropic.MessageParam[] {
  const images = request.images.map((image): Anthropic.ImageBlockParam => {
    if (!mediaTypes.has(image.mimeType)) {
      throw new ProviderError('error', `Claude does not take ${image.mimeType} images`);
    }
    return {
      type: 'image',
      source: { type: 'base64', media_type: image.mimeType as MediaType, data: image.data },
    };
  });
  let imagesPlaced = false;
  return request.messages.map((message) => {
    const content: Anthropic.ContentBlockParam[] = [];
    if (message.role === 'user' && !imagesPlaced) {
      content.push(...images);
      imagesPlaced = true;
    }
    content.push({ type: 'text', text: message.text });
    return { role: message.role === 'model' ? 'assistant' : 'user', content };
  });
}
