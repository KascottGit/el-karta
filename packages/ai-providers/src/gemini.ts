import { ApiError, GoogleGenAI, type Content, type HttpOptions, type Part } from '@google/genai';
import { ProviderError, type AiProvider, type GenerateRequest, type Usage } from './provider.ts';

// Typed locally so the package stays free of Node, browser and Deno types; every runtime has it.
declare function setTimeout(callback: () => void, ms: number): unknown;

export interface GeminiOptions {
  apiKey: string;
  fetch?: HttpOptions['fetch'];
  /** Waits between retries; tests pass one that resolves at once. */
  sleep?: (ms: number) => Promise<void>;
}

const maxAttempts = 3;
const baseDelayMs = 1000;
const retryableStatuses = new Set([429, 503]);

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function createGeminiProvider(options: GeminiOptions): AiProvider {
  const ai = new GoogleGenAI({
    apiKey: options.apiKey,
    ...(options.fetch ? { httpOptions: { fetch: options.fetch } } : {}),
  });
  const sleep = options.sleep ?? defaultSleep;

  async function call(request: GenerateRequest) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await ai.models.generateContent({
          model: request.model,
          contents: toContents(request),
          config: {
            systemInstruction: request.system,
            responseMimeType: 'application/json',
            responseJsonSchema: request.jsonSchema,
          },
        });
      } catch (error) {
        const status = error instanceof ApiError ? error.status : undefined;
        const retryable = status !== undefined && retryableStatuses.has(status);
        if (retryable && attempt < maxAttempts) {
          await sleep(baseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
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
