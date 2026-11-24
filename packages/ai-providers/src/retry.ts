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
  /** Milliseconds clock the deadline is measured on; tests inject a fake one. */
  now?: () => number;
}

interface CallOptions extends RetryOptions {
  /** Epoch milliseconds after which no attempt starts (`GenerateRequest.deadline`). */
  deadline?: number | undefined;
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
 * rate limits, overload and timeouts, all before `deadline`. Any final failure becomes a
 * `ProviderError`: `rate_limited` for 429, `unavailable` for the other retryable failures.
 */
export async function withRetries<T>(
  attempt: (signal: AbortSignalLike) => Promise<T>,
  options: CallOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const deadline = options.deadline ?? Infinity;
  for (let n = 1; ; n++) {
    const timeoutMs = Math.min(options.timeoutMs ?? defaultTimeoutMs, deadline - now());
    if (timeoutMs <= 0) {
      throw new ProviderError('unavailable', `${options.label} ran out of time before answering`);
    }
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
      const delayMs = baseDelayMs * 2 ** (n - 1);
      if (retryable && n < maxAttempts && now() + delayMs < deadline) {
        await sleep(delayMs);
        continue;
      }
      const message = timedOut
        ? `${options.label} did not answer within ${timeoutMs / 1000} s`
        : error instanceof Error
          ? error.message
          : String(error);
      const kind = status === 429 ? 'rate_limited' : retryable ? 'unavailable' : 'error';
      throw new ProviderError(kind, message, { cause: error });
    }
  }
}
