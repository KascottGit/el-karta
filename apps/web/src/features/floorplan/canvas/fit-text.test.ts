import { describe, expect, it } from 'vitest';
import { fitText } from './fit-text';

// Ten pixels per character.
const measure = (s: string) => 10 * s.length;

describe('fitText', () => {
  it('keeps text that fits', () => {
    expect(fitText('Kontor 112', 100, measure)).toBe('Kontor 112');
  });

  it('cuts text that does not fit to the longest start that fits with an ellipsis', () => {
    expect(fitText('Kontor 112', 99, measure)).toBe('Kontor 1…');
    expect(fitText('Kontor 112', 50, measure)).toBe('Kont…');
  });

  it('shows nothing when not even one character and the ellipsis fit', () => {
    expect(fitText('Kontor', 19, measure)).toBe('');
    expect(fitText('Kontor', 20, measure)).toBe('K…');
  });
});
