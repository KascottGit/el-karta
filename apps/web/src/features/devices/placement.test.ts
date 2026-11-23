import { describe, expect, it } from 'vitest';
import { FloorFixture, pt } from '@/features/view3d/geometry/test-fixtures';
import { drawnPosition, footprintCorners, sizedFootprint } from './placement';

const rounded = (points: readonly { x: number; y: number }[]) =>
  points.map(({ x, y }) => ({
    x: Math.round(x * 1000) / 1000 + 0,
    y: Math.round(y * 1000) / 1000 + 0,
  }));

describe('sizedFootprint', () => {
  it('is a floor placement with a positive size, its rotation in radians', () => {
    const floor = new FloorFixture();
    const desk = floor.device({
      kind: 'floor',
      at: pt(2, 3),
      rotation: 90,
      size: { x: 1.6, y: 0.8, z: 0.75 },
    });
    expect(sizedFootprint(desk)).toEqual({
      center: { x: 2, y: 3 },
      size: { x: 1.6, y: 0.8, z: 0.75 },
      rotation: Math.PI / 2,
    });
  });

  it('is none for a floor placement without a size or with a zero side, and for other placements', () => {
    const floor = new FloorFixture();
    const wall = floor.wall(pt(0, 0), pt(4, 0));
    for (const device of [
      floor.device({ kind: 'floor', at: pt(1, 1) }),
      floor.device({ kind: 'floor', at: pt(1, 1), size: { x: 1, y: 0, z: 1 } }),
      floor.device({ kind: 'wall', wallId: wall.id, offset: 1, height: 0.3, side: 'left' }),
    ]) {
      expect(sizedFootprint(device)).toBeNull();
    }
  });
});

describe('footprintCorners', () => {
  it('centres the footprint on its point with width along x and depth along y', () => {
    expect(
      rounded(footprintCorners({ center: pt(2, 3), size: { x: 2, y: 1, z: 1 }, rotation: 0 })),
    ).toEqual([pt(1, 2.5), pt(3, 2.5), pt(3, 3.5), pt(1, 3.5)]);
  });

  it('turns from plan +x towards +y, so a quarter turn puts the width along y', () => {
    expect(
      rounded(
        footprintCorners({ center: pt(0, 0), size: { x: 2, y: 1, z: 1 }, rotation: Math.PI / 2 }),
      ),
    ).toEqual([pt(0.5, -1), pt(0.5, 1), pt(-0.5, 1), pt(-0.5, -1)]);
  });
});

describe('drawnPosition', () => {
  it('is the resolved position, the approximate one when flagged, or none without either', () => {
    const floor = new FloorFixture();
    const wall = floor.wall(pt(0, 0), pt(4, 0), { thickness: 0.2 });
    const on = floor.device({
      kind: 'wall',
      wallId: wall.id,
      offset: 1,
      height: 0.3,
      side: 'right',
    });
    const beyond = floor.device({
      kind: 'wall',
      wallId: wall.id,
      offset: 6,
      height: 0.3,
      side: 'right',
    });
    const lost = floor.device({
      kind: 'wall',
      wallId: 'gone',
      offset: 1,
      height: 0.3,
      side: 'right',
    });
    expect(drawnPosition(floor.data, on)).toMatchObject({
      position: { x: 1, y: 0.1 },
      flagged: false,
    });
    expect(drawnPosition(floor.data, beyond)).toMatchObject({
      position: { x: 4, y: 0.1 },
      flagged: true,
    });
    expect(drawnPosition(floor.data, lost)).toBeNull();
  });
});
