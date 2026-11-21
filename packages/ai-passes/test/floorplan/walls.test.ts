import type { Pt } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import {
  alignParallel,
  cleanWalls,
  dominantOrientation,
  joinEnds,
  mergeCollinear,
  snapToOrientation,
  WALL_CLEANUP,
  type Segment,
} from '../../src/index.ts';

const seg = (a: Pt, b: Pt, thickness = 0.12, exterior = false): Segment => ({
  a,
  b,
  thickness,
  exterior,
});
const deg = (s: { a: Pt; b: Pt }) => (Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180) / Math.PI;
const rotate = (p: Pt, degrees: number): Pt => {
  const r = (degrees * Math.PI) / 180;
  return { x: Math.cos(r) * p.x - Math.sin(r) * p.y, y: Math.sin(r) * p.x + Math.cos(r) * p.y };
};
/** Angle modulo 90°, in [0, 90). */
const mod90 = (a: number) => ((a % 90) + 90) % 90;

describe('dominantOrientation', () => {
  it('finds the main direction of walls and their perpendiculars', () => {
    const walls = [
      seg({ x: 0, y: 0 }, { x: 5, y: 0 }),
      seg({ x: 0, y: 0 }, { x: 0, y: 3 }),
      seg({ x: 5, y: 3 }, { x: 0, y: 3 }),
    ];
    expect(dominantOrientation(walls)).toBeCloseTo(0, 9);
    const turned = walls.map((w) => seg(rotate(w.a, 25), rotate(w.b, 25)));
    expect((dominantOrientation(turned) * 180) / Math.PI).toBeCloseTo(25, 9);
  });

  it('weights by length, so a short diagonal does not tilt the plan', () => {
    const walls = [
      seg({ x: 0, y: 0 }, { x: 10, y: 0 }),
      seg({ x: 0, y: 0 }, { x: 0, y: 8 }),
      seg({ x: 2, y: 2 }, { x: 2.7, y: 2.7 }),
    ];
    expect(Math.abs((dominantOrientation(walls) * 180) / Math.PI)).toBeLessThan(0.5);
  });
});

describe('snapToOrientation', () => {
  it('turns walls near the orientation or its perpendicular onto it and leaves real diagonals', () => {
    const theta = (25 * Math.PI) / 180;
    const [along, across, diagonal] = snapToOrientation(
      [
        seg(rotate({ x: 0, y: 0 }, 28), rotate({ x: 4, y: 0 }, 28)),
        seg(rotate({ x: 0, y: 0 }, 21), rotate({ x: 0, y: 3 }, 21)),
        seg({ x: 0, y: 0 }, { x: 3, y: 3 }),
      ],
      theta,
      WALL_CLEANUP.snapAngle,
    );
    expect(deg(along!)).toBeCloseTo(25, 9);
    expect(along!.axis).toBe(0);
    expect(deg(across!)).toBeCloseTo(115, 9);
    expect(across!.axis).toBe(1);
    expect(deg(diagonal!)).toBeCloseTo(45, 9);
    expect(diagonal!.axis).toBeNull();
  });
});

describe('alignParallel', () => {
  it('moves snapped walls on nearly the same line onto one, weighted by length', () => {
    const snapped = snapToOrientation(
      [
        seg({ x: 0, y: 0 }, { x: 3, y: 0 }),
        seg({ x: 6, y: 0.06 }, { x: 7, y: 0.06 }),
        seg({ x: 0, y: 2 }, { x: 3, y: 2 }),
      ],
      0,
      WALL_CLEANUP.snapAngle,
    );
    const [long, short, apart] = alignParallel(snapped, 0, WALL_CLEANUP.align);
    expect(long!.a.y).toBeCloseTo(0.015, 9);
    expect(short!.a.y).toBeCloseTo(0.015, 9);
    expect(apart!.a.y).toBeCloseTo(2, 9);
  });
});

describe('mergeCollinear', () => {
  const tolerances = WALL_CLEANUP;

  it('joins overlapping and nearly touching pieces of one wall', () => {
    const merged = mergeCollinear(
      [
        seg({ x: 0, y: 0 }, { x: 3, y: 0 }),
        seg({ x: 2.8, y: 0.05 }, { x: 5, y: 0.05 }),
        seg({ x: 5.2, y: 0 }, { x: 7, y: 0 }),
      ],
      tolerances,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.a.x).toBeCloseTo(0, 9);
    expect(merged[0]!.b.x).toBeCloseTo(7, 9);
  });

  it('keeps parallel walls apart and does not close a gap wider than the tolerance', () => {
    expect(
      mergeCollinear(
        [seg({ x: 0, y: 0 }, { x: 3, y: 0 }), seg({ x: 0, y: 0.5 }, { x: 3, y: 0.5 })],
        tolerances,
      ),
    ).toHaveLength(2);
    expect(
      mergeCollinear(
        [seg({ x: 0, y: 0 }, { x: 3, y: 0 }), seg({ x: 4, y: 0 }, { x: 6, y: 0 })],
        tolerances,
      ),
    ).toHaveLength(2);
  });

  it('closes a door gap through a bridge, but a bridge alone is no wall', () => {
    const door = { a: { x: 3, y: 0 }, b: { x: 4, y: 0 } };
    const merged = mergeCollinear(
      [seg({ x: 0, y: 0 }, { x: 3, y: 0 }), seg({ x: 4, y: 0 }, { x: 6, y: 0 })],
      tolerances,
      [door, { a: { x: 9, y: 9 }, b: { x: 10, y: 9 } }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.b.x - merged[0]!.a.x).toBeCloseTo(6, 9);
  });

  it('averages thickness by length and keeps the majority exterior flag', () => {
    const [merged] = mergeCollinear(
      [seg({ x: 0, y: 0 }, { x: 3, y: 0 }, 0.3, true), seg({ x: 2, y: 0 }, { x: 4, y: 0 }, 0.1)],
      tolerances,
    );
    expect(merged!.thickness).toBeCloseTo((0.3 * 3 + 0.1 * 2) / 5, 9);
    expect(merged!.exterior).toBe(true);
  });
});

describe('joinEnds', () => {
  it('closes a corner where both walls stop short or overshoot', () => {
    const [h, v] = joinEnds(
      [seg({ x: 0, y: 0 }, { x: 4.85, y: 0 }), seg({ x: 5, y: -0.15 }, { x: 5, y: 3 })],
      WALL_CLEANUP.join,
    );
    expect(h!.b).toEqual({ x: 5, y: 0 });
    expect(v!.a.x).toBeCloseTo(5, 9);
    expect(v!.a.y).toBeCloseTo(0, 9);
  });

  it('extends a wall onto the wall it meets in a T, leaving that one unchanged', () => {
    const through = seg({ x: 0, y: 0 }, { x: 8, y: 0 });
    const [t, stem] = joinEnds([through, seg({ x: 3, y: 0.2 }, { x: 3, y: 3 })], WALL_CLEANUP.join);
    expect(t).toEqual(through);
    expect(stem!.a.x).toBeCloseTo(3, 9);
    expect(stem!.a.y).toBeCloseTo(0, 9);
  });

  it('leaves ends that are far from any other wall', () => {
    const walls = [seg({ x: 0, y: 0 }, { x: 4, y: 0 }), seg({ x: 5, y: 1 }, { x: 5, y: 3 })];
    expect(joinEnds(walls, WALL_CLEANUP.join)).toEqual(walls);
  });
});

describe('cleanWalls', () => {
  const box = (angle: number) =>
    [
      seg({ x: 0, y: 0.04 }, { x: 4.9, y: -0.03 }),
      seg({ x: 4.6, y: 0.02 }, { x: 6.1, y: 0.01 }),
      seg({ x: 6, y: -0.1 }, { x: 6.05, y: 4.1 }),
      seg({ x: 6.1, y: 4 }, { x: -0.1, y: 4.03 }),
      seg({ x: 0.02, y: 4 }, { x: -0.02, y: 0.1 }),
      seg({ x: 1, y: 1 }, { x: 1.1, y: 1.1 }),
    ].map((s) => seg(rotate(s.a, angle), rotate(s.b, angle)));

  it('turns a sloppy axis-aligned box into four exact walls meeting at the corners', () => {
    const walls = cleanWalls(box(0));
    expect(walls).toHaveLength(4);
    for (const w of walls) expect(mod90(deg(w) + 1e-9)).toBeLessThan(1e-6);
    for (const w of walls) expect(w.joined).toEqual({ a: true, b: true });
  });

  it('does the same for a plan turned 25° on the page, along its own axes', () => {
    const walls = cleanWalls(box(25));
    expect(walls).toHaveLength(4);
    const angles = walls.map((w) => mod90(deg(w)));
    for (const a of angles) expect(a).toBeCloseTo(angles[0]!, 6);
    expect(angles[0]!).toBeGreaterThan(24);
    expect(angles[0]!).toBeLessThan(26);
    for (const w of walls) expect(w.joined).toEqual({ a: true, b: true });
  });

  it('snaps a plan drawn nearly square to the page exactly onto the page axes', () => {
    const walls = cleanWalls(box(0.5));
    for (const w of walls) expect(mod90(deg(w) + 1e-9)).toBeLessThan(1e-6);
    const turned = cleanWalls(box(0.5), [], (0.5 * Math.PI) / 180);
    for (const w of turned) expect(mod90(deg(w))).toBeCloseTo(0.5, 6);
  });

  it('drops fragments shorter than the minimum', () => {
    const walls = cleanWalls([
      seg({ x: 0, y: 0 }, { x: 4, y: 0 }),
      seg({ x: 2, y: 2 }, { x: 2.2, y: 2 }),
    ]);
    expect(walls).toHaveLength(1);
  });
});
