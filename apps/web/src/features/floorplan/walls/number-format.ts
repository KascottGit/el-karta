/** Formats metres for the UI language, e.g. `3,45` in Swedish. */
export const formatNumber = (value: number, language: string, maximumFractionDigits = 3) =>
  new Intl.NumberFormat(language, { maximumFractionDigits, useGrouping: false }).format(value);

/** Reads a number typed with a decimal comma or point; null if it is not one. */
export function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  return Number(normalized);
}
