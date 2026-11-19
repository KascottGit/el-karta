import { describe, expect, it } from 'vitest';
import { samplePoints, TOUCH_RADIUS } from './hit';

describe('hit sampling', () => {
  it('tries only the point itself for a mouse', () => {
    expect(samplePoints({ x: 5, y: 6 }, 0)).toEqual([{ x: 5, y: 6 }]);
  });

  it('tries the point first, then rings at half and full finger radius', () => {
    const center = { x: 100, y: 50 };
    const points = samplePoints(center, TOUCH_RADIUS);
    expect(points[0]).toEqual(center);
    const distances = points.slice(1).map((p) => Math.hypot(p.x - center.x, p.y - center.y));
    expect(distances.slice(0, 8).every((d) => Math.abs(d - TOUCH_RADIUS / 2) < 1e-9)).toBe(true);
    expect(distances.slice(8).every((d) => Math.abs(d - TOUCH_RADIUS) < 1e-9)).toBe(true);
    expect(points).toHaveLength(17);
  });
});
