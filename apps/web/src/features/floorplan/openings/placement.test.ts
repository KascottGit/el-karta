import { OPENING_DEFAULTS, type Opening, type WallHit } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { pt, wall } from '../walls/test-fixtures';
import {
  fitOffset,
  flipHinge,
  flipSwing,
  placeOpening,
  resizeOpenings,
  slideOpening,
  withKind,
} from './placement';

const w = wall(pt(0, 0), pt(5, 0), 0.2, 'w');
const opening = (
  id: string,
  offset: number,
  width = 1,
  kind: Opening['kind'] = 'door',
): Opening => ({
  id,
  wallId: 'w',
  kind,
  offset,
  width,
  height: 2.1,
  provenance: { status: 'manual' },
});
const floorWith = (...openings: Opening[]) => ({
  walls: { w },
  openings: Object.fromEntries(openings.map((o) => [o.id, o])),
});
const hit = (offset: number, side: WallHit['side'] = 'left', length = 5): WallHit => ({
  wallId: 'w',
  offset,
  length,
  distance: 0.05,
  side,
});

describe('fitOffset', () => {
  it('keeps a free offset and clamps to the wall ends', () => {
    expect(fitOffset(1, 1, 5, [])).toBe(1);
    expect(fitOffset(-0.4, 1, 5, [])).toBe(0);
    expect(fitOffset(4.6, 1, 5, [])).toBe(4);
  });

  it('nudges beside the nearest neighbour, touching it but not overlapping', () => {
    const others = [{ offset: 2, width: 1 }];
    expect(fitOffset(1.6, 1, 5, others)).toBe(1);
    expect(fitOffset(2.6, 1, 5, others)).toBe(3);
    expect(fitOffset(1, 1, 5, others)).toBe(1);
  });

  it('jumps over a neighbour when its far side is nearer, and skips gaps that are too small', () => {
    const others = [
      { offset: 0.5, width: 1 },
      { offset: 2, width: 1 },
    ];
    // The 0.5 m gap between them is too narrow for a 1 m opening.
    expect(fitOffset(1.2, 1, 5, others)).toBe(3);
    expect(fitOffset(0.2, 1, 5, others)).toBe(3);
  });

  it('is null when the wall is too short or full', () => {
    expect(fitOffset(0, 1.2, 1, [])).toBeNull();
    expect(fitOffset(0, 1, 2, [{ offset: 0.5, width: 1 }])).toBeNull();
  });

  it('fits an opening exactly as wide as the wall', () => {
    expect(fitOffset(0.3, 2, 2, [])).toBe(0);
  });
});

describe('placeOpening', () => {
  it('centres the opening on the tapped point with the kind defaults', () => {
    const placed = placeOpening(floorWith(), 'window', hit(2), OPENING_DEFAULTS.window, 'n');
    expect(placed).toEqual({
      ok: true,
      opening: {
        id: 'n',
        wallId: 'w',
        kind: 'window',
        offset: 1.4,
        width: 1.2,
        height: 1.2,
        sill: 0.9,
        provenance: { status: 'manual' },
      },
    });
  });

  it('clamps the near edge so the opening stays on the wall', () => {
    const near = placeOpening(floorWith(), 'door', hit(0.1), OPENING_DEFAULTS.door, 'n');
    const far = placeOpening(floorWith(), 'door', hit(4.95), OPENING_DEFAULTS.door, 'n');
    expect(near.ok && near.opening.offset).toBe(0);
    expect(far.ok && far.opening.offset).toBeCloseTo(4.1);
  });

  it('nudges beside an opening it would overlap', () => {
    const placed = placeOpening(
      floorWith(opening('d', 2)),
      'door',
      hit(2.2),
      OPENING_DEFAULTS.door,
      'n',
    );
    expect(placed.ok && placed.opening.offset).toBeCloseTo(1.1);
  });

  it('refuses a wall shorter than the opening, or one with no room left', () => {
    expect(
      placeOpening(floorWith(), 'window', hit(0.5, 'left', 1), OPENING_DEFAULTS.window, 'n'),
    ).toEqual({ ok: false, reason: 'too-short' });
    const full = floorWith(opening('a', 0, 2.5), opening('b', 2.5, 2.5));
    expect(placeOpening(full, 'door', hit(2), OPENING_DEFAULTS.door, 'n')).toEqual({
      ok: false,
      reason: 'no-room',
    });
  });

  it('opens a door towards the tapped side, hinged on the left as seen from there', () => {
    const left = placeOpening(floorWith(), 'door', hit(2, 'left'), OPENING_DEFAULTS.door, 'n');
    const right = placeOpening(floorWith(), 'door', hit(2, 'right'), OPENING_DEFAULTS.door, 'n');
    expect(left.ok && [left.opening.hinge, left.opening.swing]).toEqual(['right', 'in']);
    expect(right.ok && [right.opening.hinge, right.opening.swing]).toEqual(['left', 'out']);
  });

  it('gives a passage no sill, hinge or swing', () => {
    const placed = placeOpening(floorWith(), 'passage', hit(2), OPENING_DEFAULTS.passage, 'n');
    expect(placed.ok && Object.keys(placed.opening).sort()).toEqual(
      ['height', 'id', 'kind', 'offset', 'provenance', 'wallId', 'width'].sort(),
    );
  });
});

describe('slideOpening', () => {
  it('follows the pointer along its wall, keeping where it was grabbed', () => {
    const door = opening('d', 1);
    expect(slideOpening(floorWith(door), door, 0.3, pt(2.3, 0.4))?.offset).toBeCloseTo(2);
  });

  it('stops at the wall ends', () => {
    const door = opening('d', 1);
    expect(slideOpening(floorWith(door), door, 0.5, pt(-3, 0))?.offset).toBe(0);
    expect(slideOpening(floorWith(door), door, 0.5, pt(9, 0))?.offset).toBe(4);
  });

  it('stays off its neighbours and never moves to another wall', () => {
    const door = opening('d', 0);
    const other = opening('o', 2);
    expect(slideOpening(floorWith(door, other), door, 0.5, pt(2.2, 0))?.offset).toBe(1);
    expect(slideOpening(floorWith(door, other), door, 0.5, pt(3.4, 0))?.offset).toBe(3);
    expect(slideOpening(floorWith(door, other), door, 0.5, pt(2.2, 3))?.wallId).toBe('w');
  });

  it('brings an opening beyond the wall end back onto the wall', () => {
    const outside = opening('d', 4.6);
    expect(slideOpening(floorWith(outside), outside, 0.5, pt(5, 0))?.offset).toBe(4);
  });

  it('is null when the opening fits nowhere on its wall', () => {
    const wide = opening('d', 0, 6);
    expect(slideOpening(floorWith(wide), wide, 0, pt(1, 0))).toBeNull();
  });
});

describe('resizeOpenings', () => {
  it('keeps the centre, then clamps and nudges', () => {
    const door = opening('d', 2);
    expect(resizeOpenings(floorWith(door), [door], 1.4)?.[0]).toMatchObject({
      offset: 1.8,
      width: 1.4,
    });
    const atEnd = opening('d', 4);
    expect(resizeOpenings(floorWith(atEnd), [atEnd], 2)?.[0]?.offset).toBe(3);
  });

  it('fits several openings on one wall against each other', () => {
    const a = opening('a', 1);
    const b = opening('b', 2);
    const [ra, rb] = resizeOpenings(floorWith(a, b), [a, b], 1.4) ?? [];
    expect(ra!.offset + ra!.width).toBeLessThanOrEqual(rb!.offset + 1e-9);
  });

  it('is null when one no longer fits', () => {
    const door = opening('d', 2);
    expect(resizeOpenings(floorWith(door), [door], 6)).toBeNull();
  });
});

describe('withKind and flips', () => {
  it('adds a sill for windows and a hinge and swing for doors, and drops them otherwise', () => {
    const door = { ...opening('d', 1), hinge: 'right' as const, swing: 'out' as const };
    const window = withKind(door, 'window');
    expect(window).toMatchObject({ kind: 'window', sill: 0.9, height: 1.2 });
    expect(window).not.toHaveProperty('hinge');
    expect(withKind(window, 'door')).toMatchObject({ hinge: 'left', swing: 'in', height: 2.1 });
    expect(withKind(window, 'door')).not.toHaveProperty('sill');
    const passage = withKind({ ...door, height: 2 }, 'passage');
    expect(passage).toMatchObject({ kind: 'passage', height: 2 });
    expect(passage).not.toHaveProperty('swing');
  });

  it('flips hinge and swing, treating unset values as left and in', () => {
    const door = opening('d', 1);
    expect(flipHinge(door).hinge).toBe('right');
    expect(flipHinge(flipHinge(door)).hinge).toBe('left');
    expect(flipSwing(door).swing).toBe('out');
    expect(flipSwing(flipSwing(door)).swing).toBe('in');
  });
});
