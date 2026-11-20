import { describe, expect, it } from 'vitest';
import { doorFacing } from '../src/index.ts';

describe('doorFacing', () => {
  it('opens towards the tapped side, hinged on the left as seen from there', () => {
    expect(doorFacing('left')).toEqual({ hinge: 'right', swing: 'in' });
    expect(doorFacing('right')).toEqual({ hinge: 'left', swing: 'out' });
  });

  it('describes the same physical door when the wall is drawn the other way', () => {
    // Reversing a wall swaps its sides, the end its hinge is towards, and its left and right.
    const flip = { left: 'right', right: 'left', in: 'out', out: 'in' } as const;
    for (const side of ['left', 'right'] as const) {
      const door = doorFacing(side);
      expect(doorFacing(flip[side])).toEqual({ hinge: flip[door.hinge], swing: flip[door.swing] });
    }
  });
});
