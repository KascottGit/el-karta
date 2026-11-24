import { aiPassFailureCode, type AiPassFailureCode } from '@/lib/ai-pass';

/** Why an import stopped, by its message `ai.import.errors.<code>`. */
export type ImportErrorCode =
  | AiPassFailureCode
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

/** The message for any error an import can end with. */
export function importErrorCode(error: unknown): ImportErrorCode {
  return error instanceof ImportError ? error.code : aiPassFailureCode(error);
}
