import { sortLines, type GridLine } from '@el-karta/core';

/** A common structural bay, in metres. */
export const DEFAULT_SPACING = 6;
const EMPTY_FLOOR_COUNT = 4;

/**
 * Where an evenly spaced axis starts (rounded down to 10 cm) and how many lines it needs to cover
 * `range` at `spacing`; four lines from 0 when the floor is empty.
 */
export function coveringLines(
  range: readonly [number, number] | null,
  spacing: number,
): { start: number; count: number } {
  if (!range) return { start: 0, count: EMPTY_FLOOR_COUNT };
  const start = Math.floor(range[0] * 10) / 10;
  const count = Math.max(2, Math.ceil((range[1] - start) / spacing - 1e-9) + 1);
  return { start, count };
}

/** Where a new line goes: one spacing past the last line, or at `fallback` on an empty axis. */
export function nextLinePos(lines: readonly GridLine[], fallback: number): number {
  const sorted = sortLines(lines);
  const last = sorted.at(-1);
  const before = sorted.at(-2);
  if (!last) return fallback;
  const spacing = before && last.pos > before.pos ? last.pos - before.pos : DEFAULT_SPACING;
  return Math.round((last.pos + spacing) * 1000) / 1000;
}
