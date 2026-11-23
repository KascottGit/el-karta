import { describe, expect, it } from 'vitest';
import { openingPieces } from './openings';
import { FloorFixture, pt } from './test-fixtures';
import type { Box } from './types';
import { wallPieces } from './walls';

const r = (v: number) => Math.round(v * 1000) / 1000;

/** A box on a wall along +x from x = 0, as [from, to] along it, [bottom, top] and its thickness. */
const span = (b: Box) => ({
  along: [r(b.center.x - b.size.x / 2), r(b.center.x + b.size.x / 2)],
  z: [r(b.center.z - b.size.z / 2), r(b.center.z + b.size.z / 2)],
  thickness: r(b.size.y),
});

/** The lowest gap the wall's pieces leave at `at` along a wall on +x, as [bottom, top]. */
function gap(boxes: readonly Box[], at: number, height: number): [number, number] {
  const solid = boxes
    .filter((b) => b.center.x - b.size.x / 2 < at && b.center.x + b.size.x / 2 > at)
    .map((b) => [r(b.center.z - b.size.z / 2), r(b.center.z + b.size.z / 2)] as const)
    .sort((p, q) => p[0] - q[0]);
  let bottom = 0;
  for (const [lo, hi] of solid) {
    if (lo > bottom) return [bottom, lo];
    bottom = hi;
  }
  return [bottom, height];
}

function straightWall(thickness = 0.2) {
  const floor = new FloorFixture(2.5);
  const wall = floor.wall(pt(0, 0), pt(4, 0), { thickness });
  return { floor, wall };
}

describe('openingPieces', () => {
  it('fills a door’s cut-out from the floor with a thin leaf on the centre line', () => {
    const { floor, wall } = straightWall();
    const door = floor.opening(wall.id, 'door', 1, 0.9, 2.1);
    const [piece, ...rest] = openingPieces(floor.data);
    expect(rest).toEqual([]);
    expect(piece).toMatchObject({ openingId: door.id, kind: 'door', rotation: 0 });
    expect(span(piece!)).toEqual({ along: [1, 1.9], z: [0, 2.1], thickness: 0.04 });
    expect(piece!.center.y).toBe(0);
  });

  it('fills a window’s cut-out between its sill and its top with a pane', () => {
    const { floor, wall } = straightWall();
    floor.opening(wall.id, 'window', 2, 1.2, 1.2, 0.9);
    const [piece] = openingPieces(floor.data);
    expect(piece?.kind).toBe('window');
    expect(span(piece!)).toEqual({ along: [2, 3.2], z: [0.9, 2.1], thickness: 0.02 });
  });

  it('gives a passage a volume as thick as the wall', () => {
    const { floor, wall } = straightWall(0.3);
    floor.opening(wall.id, 'passage', 0.5, 1, 2.1);
    const [piece] = openingPieces(floor.data);
    expect(piece?.kind).toBe('passage');
    expect(span(piece!)).toEqual({ along: [0.5, 1.5], z: [0, 2.1], thickness: 0.3 });
  });

  it('is never thicker than a thin wall', () => {
    const { floor, wall } = straightWall(0.01);
    floor.opening(wall.id, 'door', 1, 0.9, 2.1);
    expect(openingPieces(floor.data)[0]?.size.y).toBe(0.01);
  });

  it('is clamped to its wall exactly as the cut-out is', () => {
    const { floor, wall } = straightWall();
    floor.opening(wall.id, 'window', 3, 5, 2, 1);
    const [piece] = openingPieces(floor.data);
    expect(span(piece!)).toEqual({ along: [3, 4], z: [1, 2.5], thickness: 0.02 });
    expect(gap(wallPieces(floor.data), 3.5, 2.5)).toEqual([1, 2.5]);
  });

  it('follows a turned wall and the wall’s own height', () => {
    const floor = new FloorFixture(2.5);
    const wall = floor.wall(pt(1, 1), pt(1, 4), { height: 2 });
    floor.opening(wall.id, 'door', 1, 1, 2.1);
    const [piece] = openingPieces(floor.data);
    expect(piece?.rotation).toBeCloseTo(Math.PI / 2);
    expect(piece?.center).toEqual({ x: 1, y: 2.5, z: 1 });
    expect(piece?.size.z).toBe(2);
  });

  it('skips openings on a missing wall or clamped to nothing', () => {
    const { floor, wall } = straightWall();
    floor.opening('gone', 'door', 1, 0.9, 2.1);
    floor.opening(wall.id, 'window', 5, 1, 1, 1);
    floor.opening(wall.id, 'window', 1, 1, 1, 3);
    expect(openingPieces(floor.data)).toEqual([]);
  });
});
