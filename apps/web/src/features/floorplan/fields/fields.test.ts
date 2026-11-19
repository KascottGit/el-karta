import { describe, expect, it } from 'vitest';
import { textToCommit } from './commit';
import { decimalText, formatDecimal, parseDecimal, readDecimal } from './numbers';

describe('parseDecimal', () => {
  it('reads decimal commas, points, spaces and minus signs', () => {
    expect(parseDecimal('3,45')).toBe(3.45);
    expect(parseDecimal(' 3.45 ')).toBe(3.45);
    expect(parseDecimal('12 500,5')).toBe(12500.5);
    expect(parseDecimal('-2,5')).toBe(-2.5);
    expect(parseDecimal('−2,5')).toBe(-2.5);
    expect(parseDecimal(',5')).toBe(0.5);
    expect(parseDecimal('7')).toBe(7);
  });

  it('rejects anything else', () => {
    for (const text of ['', ' ', 'abc', '3,4,5', '1.2.3', '3 m', '--1', '1e3', ',']) {
      expect(parseDecimal(text)).toBeNull();
    }
  });

  it('reads back what formatDecimal writes', () => {
    for (const value of [0, 1.5, -12.25, 1234.5678]) {
      expect(parseDecimal(formatDecimal(value, 3))).toBeCloseTo(value, 3);
    }
    expect(formatDecimal(1234.5678, 2)).toBe('1234,57');
    expect(formatDecimal(-0.5, 1)).toBe('-0,5');
    expect(formatDecimal(6.5, 3)).toBe('6,5');
    expect(formatDecimal(1.23456, 3)).toBe('1,235');
  });
});

describe('readDecimal', () => {
  it('reads a number, or null for an empty optional field', () => {
    expect(readDecimal('2,5')).toEqual({ ok: true, value: 2.5 });
    expect(readDecimal('', { optional: true })).toEqual({ ok: true, value: null });
    expect(readDecimal('  ', { optional: true })).toEqual({ ok: true, value: null });
  });

  it('rejects empty required fields, non-numbers and values outside the rules', () => {
    expect(readDecimal('').ok).toBe(false);
    expect(readDecimal('tre', { optional: true }).ok).toBe(false);
    expect(readDecimal('0', { accept: (v) => v > 0 }).ok).toBe(false);
    expect(readDecimal('0,1', { accept: (v) => v > 0 }).ok).toBe(true);
  });
});

describe('decimalText', () => {
  it('rounds for display and is empty when unset or mixed', () => {
    expect(decimalText(12.345678, 1)).toBe('12,3');
    expect(decimalText(null, 2)).toBe('');
    expect(decimalText(undefined, 2)).toBe('');
    expect(decimalText(4, 2, true)).toBe('');
  });
});

describe('committing a field', () => {
  const valid = (text: string) => parseDecimal(text) !== null;

  it('makes no edit when the field is left with the text it showed, even if that was rounded', () => {
    const shown = decimalText(12.345678, 1);
    expect(textToCommit(null, shown, valid)).toBeNull();
    expect(textToCommit(shown, shown, valid)).toBeNull();
  });

  it('commits a changed, valid text and drops an invalid one', () => {
    expect(textToCommit('12,4', '12,3', valid)).toBe('12,4');
    expect(textToCommit('12.3', '12,3', valid)).toBe('12.3');
    expect(textToCommit('tolv', '12,3', valid)).toBeNull();
  });

  it('leaves a mixed field alone until something is typed', () => {
    const shown = decimalText(1, 2, true);
    expect(textToCommit('', shown, valid)).toBeNull();
    expect(textToCommit('0,9', shown, valid)).toBe('0,9');
  });
});
