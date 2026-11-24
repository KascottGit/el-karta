import { describe, expect, it } from 'vitest';
import { firstFitting, scaleToFit } from './image-encoding';

describe('scaleToFit', () => {
  it('shrinks the long side to the limit and never enlarges', () => {
    expect(scaleToFit(4000, 3000, 2048)).toBeCloseTo(0.512);
    expect(scaleToFit(3000, 4000, 2048)).toBeCloseTo(0.512);
    expect(scaleToFit(1000, 800, 2048)).toBe(1);
  });
});

describe('firstFitting', () => {
  it('returns the first encoding that fits, without trying later ones', async () => {
    const tried: number[] = [];
    const found = await firstFitting(
      [1, 0.5, 0.25],
      (scale) => {
        tried.push(scale);
        return Promise.resolve('x'.repeat(scale * 100));
      },
      60,
    );
    expect(found).toEqual({ encoding: 0.5, data: 'x'.repeat(50) });
    expect(tried).toEqual([1, 0.5]);
  });

  it('gives null when nothing fits', async () => {
    expect(await firstFitting([1], () => Promise.resolve('xx'), 1)).toBeNull();
  });
});
