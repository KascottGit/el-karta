/**
 * The text to commit when a field is left: only a valid draft that differs from the shown text.
 * Comparing text rather than numbers means leaving an untouched field never makes an edit, even
 * when the shown text is rounded.
 */
export const textToCommit = (
  draft: string | null,
  shown: string,
  valid: (text: string) => boolean,
): string | null => (draft !== null && draft !== shown && valid(draft) ? draft : null);
