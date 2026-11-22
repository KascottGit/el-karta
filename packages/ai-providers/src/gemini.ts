import {
  ApiError,
  GoogleGenAI,
  type Content,
  type GenerateContentConfig,
  type HttpOptions,
  type Part,
} from '@google/genai';
import { ProviderError, type AiProvider, type GenerateRequest, type Usage } from './provider.ts';

// Typed locally so the package stays free of Node, browser and Deno types; every runtime has it.
declare function setTimeout(callback: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;
declare const AbortController: new () => { signal: unknown; abort(): void };

export interface GeminiOptions {
  apiKey: string;
  fetch?: HttpOptions['fetch'];
  /** Waits between retries; tests pass one that resolves at once. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Per attempt, enforced on our side. Not sent to Google as a deadline: with one, an overloaded
   * model queues the request until the deadline and answers 504 instead of a quick 503.
   */
  timeoutMs?: number;
}

const maxAttempts = 3;
const baseDelayMs = 1000;
const retryableStatuses = new Set([429, 503, 504]);
const defaultTimeoutMs = 120_000;

const isTimeout = (error: unknown) =>
  error instanceof Error &&
  (error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    /timed? ?out|abort/i.test(error.message));

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function createGeminiProvider(options: GeminiOptions): AiProvider {
  // The `-latest` model aliases and `responseJsonSchema` are only served on v1beta.
  const ai = new GoogleGenAI({
    apiKey: options.apiKey,
    apiVersion: 'v1beta',
    ...(options.fetch ? { httpOptions: { fetch: options.fetch } } : {}),
  });
  const sleep = options.sleep ?? defaultSleep;

  async function call(request: GenerateRequest) {
    for (let attempt = 1; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, options.timeoutMs ?? defaultTimeoutMs);
      try {
        const response = await ai.models.generateContent({
          model: request.model,
          contents: toContents(request),
          config: {
            systemInstruction: request.system,
            responseMimeType: 'application/json',
            responseJsonSchema: request.jsonSchema,
            abortSignal: controller.signal as NonNullable<GenerateContentConfig['abortSignal']>,
          },
        });
        clearTimeout(timer);
        return response;
      } catch (error) {
        clearTimeout(timer);
        const status = error instanceof ApiError ? error.status : undefined;
        const timedOut = status === undefined && isTimeout(error);
        const retryable = timedOut || (status !== undefined && retryableStatuses.has(status));
        if (retryable && attempt < maxAttempts) {
          await sleep(baseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        const message = timedOut
          ? `Gemini did not answer within ${(options.timeoutMs ?? defaultTimeoutMs) / 1000} s`
          : error instanceof Error
            ? error.message
            : String(error);
        throw new ProviderError(status === 429 ? 'rate_limited' : 'error', message, {
          cause: error,
        });
      }
    }
  }

  return {
    id: 'gemini',
    async generateStructured(request) {
      const response = await call(request);
      const text = response.text;
      if (text === undefined || text === '') {
        const reason = response.candidates?.[0]?.finishReason ?? 'no candidates';
        throw new ProviderError('error', `Gemini returned no text (${reason})`);
      }
      const meta = response.usageMetadata;
      const usage: Usage = {};
      if (meta?.promptTokenCount !== undefined) usage.inputTokens = meta.promptTokenCount;
      // Thinking tokens are billed as output, so they count towards the run's cost.
      if (meta?.candidatesTokenCount !== undefined || meta?.thoughtsTokenCount !== undefined) {
        usage.outputTokens = (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0);
      }
      return {
        text,
        usage,
        ...(response.modelVersion ? { modelVersion: response.modelVersion } : {}),
      };
    },
  };
}

function toContents(request: GenerateRequest): Content[] {
  const images = request.images.map((image) => ({
    inlineData: { mimeType: image.mimeType, data: image.data },
  }));
  let imagesPlaced = false;
  return request.messages.map((message) => {
    const parts: Part[] = [];
    if (message.role === 'user' && !imagesPlaced) {
      parts.push(...images);
      imagesPlaced = true;
    }
    parts.push({ text: message.text });
    return { role: message.role, parts };
  });
}
