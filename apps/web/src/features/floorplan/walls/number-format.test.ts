import { describe, expect, it } from 'vitest';
import { formatNumber, parseNumber } from './number-format';

describe('number format', () => {
  it('reads a decimal comma or point, with spaces', () => {
    expect(parseNumber('0,12')).toBe(0.12);
    expect(parseNumber(' 3.5 ')).toBe(3.5);
    expect(parseNumber('1 200,5')).toBe(1200.5);
    expect(parseNumber(',3')).toBe(0.3);
  });

  it('rejects anything that is not a number', () => {
    for (const text of ['', 'abc', '1,2,3', '1e3', '2 m']) expect(parseNumber(text)).toBeNull();
  });

  it('writes Swedish decimals without grouping', () => {
    expect(formatNumber(1234.5678, 'sv')).toBe('1234,568');
    expect(formatNumber(0.3, 'sv', 2)).toBe('0,3');
  });
});
