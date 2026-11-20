/**
 * A number typed the Swedish way or the English way: decimal comma or point, spaces as thousands
 * separators, and the minus sign `Intl` uses for Swedish. Null for anything else.
 */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(/\s/g, '').replace(/−/g, '-').replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** For number fields: Swedish decimal comma, no grouping, an ASCII minus so it reads back. */
export function formatDecimal(value: number, digits: number): string {
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: digits, useGrouping: false })
    .format(value)
    .replace(/−/g, '-');
}

/** An `accept` rule for lengths, thicknesses and heights. */
export const positive = (value: number) => value > 0;

export interface DecimalRules {
  /** Empty text means "no value", committed as null. */
  optional?: boolean;
  /** Further limits, such as a positive length. */
  accept?: (value: number) => boolean;
}

/** What a decimal field's text stands for: a number, null for an empty optional field, or invalid. */
export function readDecimal(
  text: string,
  { optional = false, accept }: DecimalRules = {},
): { ok: true; value: number | null } | { ok: false } {
  if (optional && text.trim() === '') return { ok: true, value: null };
  const value = parseDecimal(text);
  return value !== null && (accept?.(value) ?? true) ? { ok: true, value } : { ok: false };
}

/**
 * The text a decimal field shows: empty when unset, or when several selected items differ
 * (`mixed`), so the field shows its placeholder instead.
 */
export const decimalText = (value: number | null | undefined, digits: number, mixed = false) =>
  mixed || value === null || value === undefined ? '' : formatDecimal(value, digits);

/**
 * The value several selected items share for a field, or `mixed` when they differ. Items that all
 * leave an optional value unset share `undefined`, so the field can show what that falls back to.
 */
export function sharedValue<T>(values: readonly T[]): { value: T | undefined; mixed: boolean } {
  const mixed = values.some((v) => v !== values[0]);
  return { value: mixed ? undefined : values[0], mixed };
}
