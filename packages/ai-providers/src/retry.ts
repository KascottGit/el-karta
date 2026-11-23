import { ProviderError } from './provider.ts';

// Typed locally so the package stays free of Node, browser and Deno types; every runtime has it.
declare function setTimeout(callback: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;
declare const AbortController: new () => { signal: AbortSignalLike; abort(): void };

/** The part of `AbortSignal` the SDKs need; cast to their own type at the call. */
export interface AbortSignalLike {
  readonly aborted: boolean;
}

export interface RetryOptions {
  /** Waits between retries; tests pass one that resolves at once. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Per attempt, enforced on our side. Not sent to the provider as a deadline: with one, an
   * overloaded model may queue the request until the deadline instead of failing fast.
   */
  timeoutMs?: number;
}

interface CallOptions extends RetryOptions {
  /** Provider name for error messages. */
  label: string;
  /** The HTTP status of a failed attempt, if the error carries one. */
  statusOf: (error: unknown) => number | undefined;
}

const maxAttempts = 3;
const baseDelayMs = 1000;
// 529 is Anthropic's "overloaded".
const retryableStatuses = new Set([429, 503, 504, 529]);
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

/**
 * Runs `attempt` with a per-attempt timeout and up to three attempts with exponential backoff on
 * rate limits, overload and timeouts. Any final failure becomes a `ProviderError`.
 */
export async function withRetries<T>(
  attempt: (signal: AbortSignalLike) => Promise<T>,
  options: CallOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  for (let n = 1; ; n++) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const result = await attempt(controller.signal);
      clearTimeout(timer);
      return result;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof ProviderError) throw error;
      const status = options.statusOf(error);
      const timedOut = status === undefined && isTimeout(error);
      const retryable = timedOut || (status !== undefined && retryableStatuses.has(status));
      if (retryable && n < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (n - 1));
        continue;
      }
      const message = timedOut
        ? `${options.label} did not answer within ${timeoutMs / 1000} s`
        : error instanceof Error
          ? error.message
          : String(error);
      throw new ProviderError(status === 429 ? 'rate_limited' : 'error', message, {
        cause: error,
      });
    }
  }
}
