import { describe, expect, it } from 'vitest';
import {
  closestOnAxis,
  distanceToSegment,
  hitLevel,
  metresPerPixel,
  planRay,
  type Ray,
} from './ray';

const unit = (x: number, y: number, z: number) => {
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
};
const ray = (origin: [number, number, number], dir: [number, number, number]): Ray => ({
  origin: { x: origin[0], y: origin[1], z: origin[2] },
  dir: unit(...dir),
});

describe('closestOnAxis', () => {
  const at = { x: 1, y: 2, z: 0 };
  const xAxis = { x: 1, y: 0, z: 0 };

  it('gives the distance along the axis where a crossing ray passes', () => {
    // Straight down onto the point 3 m along the axis.
    expect(closestOnAxis(ray([4, 2, 10], [0, 0, -1]), at, xAxis)).toBeCloseTo(3);
    // Down at an angle that crosses the axis line at x = -1.5.
    expect(closestOnAxis(ray([-1.5, -3, 5], [0, 5, -5]), at, xAxis)).toBeCloseTo(-2.5);
  });

  it('takes the closest point of a skew ray', () => {
    // A ray along +y at height 1, passing over the axis at x = 2.
    expect(closestOnAxis(ray([2, -5, 1], [0, 1, 0]), at, xAxis)).toBeCloseTo(1);
  });

  it('is null for a ray along the axis or one pointing away from it', () => {
    expect(closestOnAxis(ray([0, 2, 0], [1, 0, 0]), at, xAxis)).toBeNull();
    expect(closestOnAxis(ray([0, 2, 0], [1, 0.01, 0]), at, xAxis)).toBeNull();
    expect(closestOnAxis(ray([4, 2, 10], [0, 0, 1]), at, xAxis)).toBeNull();
  });

  it('works for a vertical axis', () => {
    const up = { x: 0, y: 0, z: 1 };
    expect(closestOnAxis(ray([1, -8, 2.5], [0, 1, 0]), at, up)).toBeCloseTo(2.5);
  });
});

describe('hitLevel', () => {
  it('meets the horizontal plane at a height', () => {
    const hit = hitLevel(ray([0, 0, 5], [1, 1, -1]), 2);
    expect(hit?.x).toBeCloseTo(3);
    expect(hit?.y).toBeCloseTo(3);
  });

  it('is null for a level ray or one pointing away', () => {
    expect(hitLevel(ray([0, 0, 5], [1, 0, 0]), 2)).toBeNull();
    expect(hitLevel(ray([0, 0, 5], [0, 0, 1]), 2)).toBeNull();
  });
});

describe('planRay', () => {
  it('swaps three.js y and z and measures z from the floor base', () => {
    const r = planRay({ x: 1, y: 7, z: 3 }, { x: 0, y: -1, z: 0 }, 2);
    expect(r).toEqual({ origin: { x: 1, y: 3, z: 5 }, dir: { x: 0, y: 0, z: -1 } });
  });
});

describe('metresPerPixel', () => {
  it('covers the visible height at the depth in the canvas height', () => {
    // A 90° field of view shows 2 × depth.
    expect(metresPerPixel(5, 90, 1000)).toBeCloseTo(0.01);
    expect(metresPerPixel(10, 90, 1000)).toBeCloseTo(0.02);
  });
});

describe('distanceToSegment', () => {
  it('measures to the nearest point of the segment, or to a point', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(distanceToSegment({ x: 5, y: 3 }, a, b)).toBeCloseTo(3);
    expect(distanceToSegment({ x: 13, y: 4 }, a, b)).toBeCloseTo(5);
    expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBeCloseTo(5);
  });
});
