/**
 * A number typed the Swedish way or the English way: decimal comma or point, spaces as thousands
 * separators, and the minus sign `Intl` uses for Swedish. Null for anything else.
 */
export function parseDecimal(text: string): number | null {
  const normalized = text
    .trim()
    .replace(/\s/g, '')
    .replace(/\u2212/g, '-')
    .replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** For number fields: Swedish decimal comma, no grouping, an ASCII minus so it reads back. */
export function formatDecimal(value: number, maxFractionDigits: number): string {
  return new Intl.NumberFormat('sv-SE', {
    maximumFractionDigits: maxFractionDigits,
    useGrouping: false,
  })
    .format(value)
    .replace(/\u2212/g, '-');
}
