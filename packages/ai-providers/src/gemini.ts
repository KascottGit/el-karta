import {
  ApiError,
  GoogleGenAI,
  type Content,
  type GenerateContentConfig,
  type HttpOptions,
  type Part,
} from '@google/genai';
import { ProviderError, type AiProvider, type GenerateRequest, type Usage } from './provider.ts';
import { withRetries, type RetryOptions } from './retry.ts';

export interface GeminiOptions extends RetryOptions {
  apiKey: string;
  fetch?: HttpOptions['fetch'];
}

export function createGeminiProvider(options: GeminiOptions): AiProvider {
  // The `-latest` model aliases and `responseJsonSchema` are only served on v1beta.
  const ai = new GoogleGenAI({
    apiKey: options.apiKey,
    apiVersion: 'v1beta',
    ...(options.fetch ? { httpOptions: { fetch: options.fetch } } : {}),
  });

  const call = (request: GenerateRequest) =>
    withRetries(
      (signal) =>
        ai.models.generateContent({
          model: request.model,
          contents: toContents(request),
          config: {
            systemInstruction: request.system,
            responseMimeType: 'application/json',
            responseJsonSchema: request.jsonSchema,
            abortSignal: signal as NonNullable<GenerateContentConfig['abortSignal']>,
          },
        }),
      {
        ...options,
        label: 'Gemini',
        statusOf: (error) => (error instanceof ApiError ? error.status : undefined),
      },
    );

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
