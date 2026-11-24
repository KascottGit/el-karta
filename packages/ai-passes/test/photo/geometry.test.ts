import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  ceilingSlots,
  degenerate,
  fitHomography,
  planeRef,
  wallFrame,
  type PhotoWall,
} from '../../src/index.ts';
import { id, reference, room } from './fixtures.ts';

const wall = (side: 'left' | 'right'): PhotoWall => ({
  id: id(1),
  a: { x: 0, y: 0 },
  b: { x: 5, y: 0 },
  thickness: 0.2,
  side,
});

describe('wallFrame', () => {
  it('takes the visible face from the room polygon and puts `a` on the left from the right side', () => {
    const polygon = [
      { x: 1, y: 0.1 },
      { x: 3, y: 0.1 },
      { x: 3, y: 2 },
      { x: 1, y: 2 },
    ];
    expect(wallFrame(wall('right'), polygon)).toEqual({
      length: 5,
      start: 1,
      end: 3,
      leftEnd: 'a',
    });
    expect(wallFrame(wall('left'), polygon).leftEnd).toBe('b');
  });

  it('uses the whole wall when the polygon does not touch it', () => {
    const far = [
      { x: 0, y: 3 },
      { x: 1, y: 3 },
      { x: 1, y: 4 },
    ];
    expect(wallFrame(wall('right'), far)).toMatchObject({ start: 0, end: 5 });
  });
});

describe('planeRef', () => {
  const context = room({ reverseA: true });
  const frames = context.walls.map((w) => wallFrame(w, context.room.polygon));

  it('maps image left and right to the wall ends by the side the room is on', () => {
    // Reversed A: `a` is at the right end of the face, so the image-left floor corner is `end`.
    const left = planeRef(
      reference('wall_corner', 'A', 'bottom_left', { x: 0, y: 0 }),
      context,
      frames,
    );
    expect(left).toMatchObject({ wall: 0, u: 4.05, v: 0, ceiling: false });
    const top = planeRef(
      reference('wall_corner', 'A', 'top_right', { x: 0, y: 0 }),
      context,
      frames,
    );
    expect(top).toMatchObject({ v: 2.5, ceiling: true });
    expect(top!.u).toBeCloseTo(0.05, 9);
  });

  it('gives opening corners from offset, width, sill and height', () => {
    const window = context.openings[0]!;
    const tl = planeRef(
      reference('opening_corner', 'O1', 'top_left', { x: 0, y: 0 }),
      context,
      frames,
    );
    expect(tl).toMatchObject({ opening: 0, u: window.offset + window.width, v: 2.1 });
    const door = planeRef(
      reference('opening_corner', 'O2', 'bottom_right', { x: 0, y: 0 }),
      context,
      frames,
    );
    expect(door).toMatchObject({ opening: 1, u: context.openings[1]!.offset, v: 0 });
  });

  it('has no height for a window without a sill, and nothing for unknown refs', () => {
    const noSill = room();
    delete noSill.openings[0]!.sill;
    const f = noSill.walls.map((w) => wallFrame(w, noSill.room.polygon));
    expect(
      planeRef(reference('opening_corner', 'O1', 'top_left', { x: 0, y: 0 }), noSill, f)?.v,
    ).toBeNull();
    expect(
      planeRef(reference('opening_corner', 'O9', 'top_left', { x: 0, y: 0 }), noSill, f),
    ).toBeNull();
    expect(
      planeRef(reference('wall_corner', 'Q', 'top_left', { x: 0, y: 0 }), noSill, f),
    ).toBeNull();
  });
});

describe('fitHomography', () => {
  // A known projective map from image to plane.
  const h = [0.004, 0.0005, -0.3, -0.0002, -0.003, 2.8, 0.00001, 0.00002, 1];
  const map = (p: { x: number; y: number }) => {
    const w = h[6]! * p.x + h[7]! * p.y + h[8]!;
    return {
      x: (h[0]! * p.x + h[1]! * p.y + h[2]!) / w,
      y: (h[3]! * p.x + h[4]! * p.y + h[5]!) / w,
    };
  };
  const images = [
    { x: 100, y: 900 },
    { x: 900, y: 880 },
    { x: 850, y: 150 },
    { x: 120, y: 100 },
    { x: 500, y: 500 },
  ];

  it('recovers the map exactly from four points and by least squares from more', () => {
    for (const n of [4, 5]) {
      const fit = fitHomography(images.slice(0, n).map((image) => ({ image, plane: map(image) })));
      expect(fit).not.toBeNull();
      const probe = { x: 300, y: 700 };
      const got = applyHomography(fit!, probe)!;
      expect(got.x).toBeCloseTo(map(probe).x, 6);
      expect(got.y).toBeCloseTo(map(probe).y, 6);
    }
  });

  it('refuses fewer than four points or all but one on a line', () => {
    expect(
      fitHomography(images.slice(0, 3).map((image) => ({ image, plane: map(image) }))),
    ).toBeNull();
    const line = [0, 1, 2, 3].map((u) => ({ x: u, y: 0 }));
    expect(degenerate(line, 0.01)).toBe(true);
    expect(degenerate([...line.slice(0, 3), { x: 1, y: 1 }], 0.01)).toBe(true);
    expect(degenerate([...line.slice(0, 2), { x: 1, y: 1 }, { x: 0, y: 1 }], 0.01)).toBe(false);
  });

  it('maps nothing beyond the horizon', () => {
    const fit = fitHomography(images.slice(0, 4).map((image) => ({ image, plane: map(image) })))!;
    // w < 0 past the line 0.00001 x + 0.00002 y + 1 = 0.
    expect(applyHomography(fit, { x: -200000, y: 0 })).toBeNull();
  });
});

describe('ceilingSlots', () => {
  it('spreads lights along the long axis of a tall room', () => {
    const tall = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 6 },
      { x: 0, y: 6 },
    ];
    const slots = ceilingSlots(tall, 3);
    expect(slots.map((s) => [Math.round(s.x * 100) / 100, Math.round(s.y * 100) / 100])).toEqual([
      [1, 1],
      [1, 3],
      [1, 5],
    ]);
  });
});
