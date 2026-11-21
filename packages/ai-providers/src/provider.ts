/** An image sent to the model, base64-encoded. */
export interface ImageInput {
  mimeType: string;
  data: string;
}

export interface Message {
  role: 'user' | 'model';
  text: string;
}

export interface GenerateRequest {
  model: string;
  system: string;
  /** Images belong to the first user message. */
  messages: Message[];
  images: ImageInput[];
  /** JSON Schema for structured output, from `z.toJSONSchema`. */
  jsonSchema: Record<string, unknown>;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface GenerateResponse {
  /** The model's raw text; the caller parses and validates it. */
  text: string;
  /** The exact model version that answered, when the provider reports it. */
  modelVersion?: string;
  usage: Usage;
}

export type ProviderErrorKind = 'rate_limited' | 'error';

export class ProviderError extends Error {
  override name = 'ProviderError';
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** One interface for every AI provider, so passes and evals never depend on a vendor SDK. */
export interface AiProvider {
  readonly id: string;
  generateStructured(request: GenerateRequest): Promise<GenerateResponse>;
}
