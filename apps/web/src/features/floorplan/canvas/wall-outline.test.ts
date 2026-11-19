import type { Wall } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { endKey, jointEnds, wallOutline } from './wall-outline';

const wall = (id: string, a: [number, number], b: [number, number], thickness = 0.2): Wall => ({
  id,
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  thickness,
  provenance: { status: 'manual' },
});

// Rounded, and with -0 turned into 0, so corners compare with toEqual.
const corners = (flat: number[]) => {
  const out: number[][] = [];
  for (let i = 0; i < flat.length; i += 2) {
    out.push([flat[i]!, flat[i + 1]!].map((v) => Number(v.toFixed(6)) + 0));
  }
  return out;
};

describe('wall outline', () => {
  it('is a rectangle of the wall thickness around the centre line', () => {
    expect(corners(wallOutline(wall('w', [0, 0], [4, 0]), false, false))).toEqual([
      [0, -0.1],
      [4, -0.1],
      [4, 0.1],
      [0, 0.1],
    ]);
  });

  it('extends joined ends by half the thickness', () => {
    expect(corners(wallOutline(wall('w', [0, 0], [0, 3], 0.4), true, false))).toEqual([
      [0.2, -0.2],
      [0.2, 3],
      [-0.2, 3],
      [-0.2, -0.2],
    ]);
  });
});

describe('joint ends', () => {
  it('finds ends within a centimetre of another wall end, including across grid cells', () => {
    const walls = Object.fromEntries(
      [
        wall('a', [0, 0], [4, 0]),
        wall('b', [4.004, 0.006], [4, 3]),
        wall('c', [10, 10], [12, 10]),
        wall('d', [-0.0099, 0], [-3, 0]),
        wall('e', [12.02, 10], [14, 10]),
      ].map((w) => [w.id, w]),
    );
    const joints = jointEnds(walls);
    expect([...joints].sort()).toEqual(
      [endKey('a', 'a'), endKey('a', 'b'), endKey('b', 'a'), endKey('d', 'a')].sort(),
    );
  });

  it('does not join a wall to itself', () => {
    expect(jointEnds({ z: wall('z', [0, 0], [0.005, 0]) }).size).toBe(0);
  });
});
