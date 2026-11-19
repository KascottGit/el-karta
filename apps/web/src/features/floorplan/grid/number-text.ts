const format = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 3, useGrouping: false });

/** A number as Swedish text, with a decimal comma and at most three decimals (millimetres). */
export const formatNumber = (n: number): string => format.format(n);

/** Reads a typed number with a decimal comma or point; null if it is not one. */
export function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(',', '.').replace('−', '-');
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
