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
  /**
   * Epoch milliseconds (`Date.now()`) after which no attempt starts; each attempt's timeout is cut
   * to the time left. Lets a caller with a wall-clock limit keep time for a fallback.
   */
  deadline?: number;
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

/**
 * `rate_limited` (429) and `unavailable` (overload, 5xx the retries did not get past, timeouts)
 * are outages, where another provider may answer; `error` is anything else (bad request, refusal,
 * cut-off or empty answer).
 */
export type ProviderErrorKind = 'rate_limited' | 'unavailable' | 'error';

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
