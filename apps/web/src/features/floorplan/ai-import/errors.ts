import { AiPassError } from '@el-karta/data-supabase';

/** Why an import stopped, by its message `ai.import.errors.<code>`. */
export type ImportErrorCode =
  /** The per-user limit of the `ai-pass` function. */
  | 'rate_limited'
  /** The AI provider's own limit or overload. */
  | 'provider_busy'
  | 'too_large'
  | 'forbidden'
  | 'network'
  | 'internal'
  /** The model answered with nothing usable. */
  | 'no_output'
  /** The reading gave nothing to suggest. */
  | 'empty'
  /** The background image is not loaded. */
  | 'image';

export class ImportError extends Error {
  override name = 'ImportError';
  constructor(readonly code: ImportErrorCode) {
    super(`AI import failed: ${code}`);
  }
}

export const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError';

/** The message for any error an import can end with. */
export function importErrorCode(error: unknown): ImportErrorCode {
  if (error instanceof ImportError) return error.code;
  if (!(error instanceof AiPassError)) return 'internal';
  switch (error.code) {
    case 'rate_limited':
    case 'too_large':
      return error.code;
    case 'forbidden':
    case 'unauthorized':
      return 'forbidden';
    default:
      // Without an HTTP status the request never got an answer.
      return error.status === undefined ? 'network' : 'internal';
  }
}

/** Rejects with an AbortError as soon as `signal` aborts, whether or not `promise` settles. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}
