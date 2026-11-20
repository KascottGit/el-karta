import type { Opening } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { pt, wall } from '../walls/test-fixtures';
import { openingSymbol } from './symbol';

// Along +x, so the wall's left side is up the screen (negative y).
const w = wall(pt(0, 0), pt(5, 0), 0.2, 'w');
const door: Opening = {
  id: 'd',
  wallId: 'w',
  kind: 'door',
  offset: 1,
  width: 1,
  height: 2.1,
  hinge: 'left',
  swing: 'in',
  provenance: { status: 'manual' },
};

const close = (actual: readonly number[] | undefined, expected: readonly number[]) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, i) => {
    expect(actual![i]).toBeCloseTo(v);
  });
};

describe('opening symbol', () => {
  it('covers the wall across its thickness between the two edges', () => {
    const symbol = openingSymbol(w, door)!;
    close(symbol.gap, [1, -0.1, 2, -0.1, 2, 0.1, 1, 0.1]);
    expect(symbol.centre).toEqual(pt(1.5, 0));
  });

  it('opens the leaf from the hinge towards the swing side and sweeps to the other edge', () => {
    const inLeft = openingSymbol(w, door)!;
    close(inLeft.leaf, [1, -0.1, 1, -1.1]);
    close(inLeft.arc!.slice(0, 2), [1, -1.1]);
    close(inLeft.arc!.slice(-2), [2, -0.1]);

    const outRight = openingSymbol(w, { ...door, hinge: 'right', swing: 'out' })!;
    close(outRight.leaf, [2, 0.1, 2, 1.1]);
    close(outRight.arc!.slice(-2), [1, 0.1]);
  });

  it('draws two panes for a window and nothing more for a passage', () => {
    const window = openingSymbol(w, { ...door, kind: 'window' })!;
    expect(window.leaf).toBeUndefined();
    close(window.panes?.[0], [1, -0.1 / 3, 2, -0.1 / 3]);
    close(window.panes?.[1], [1, 0.1 / 3, 2, 0.1 / 3]);
    const passage = openingSymbol(w, { ...door, kind: 'passage' })!;
    expect([passage.leaf, passage.arc, passage.panes]).toEqual([undefined, undefined, undefined]);
  });

  it('is null on a wall without length', () => {
    expect(openingSymbol(wall(pt(1, 1), pt(1, 1)), door)).toBeNull();
  });
});
