import { generateProject } from '@el-karta/core';
import { describe, expect, it, vi } from 'vitest';
import { createCuller } from './culling';
import { boundsOf, contains, expand, intersects, union, type Rect } from './rect';
import { wallBounds } from '../walls/wall-outline';

const box = (minX: number, minY: number, maxX: number, maxY: number): Rect => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe('rectangles', () => {
  it('bounds points with padding, and nothing for no points', () => {
    expect(
      boundsOf(
        [
          { x: 1, y: 5 },
          { x: -2, y: 3 },
        ],
        0.5,
      ),
    ).toEqual(box(-2.5, 2.5, 1.5, 5.5));
    expect(boundsOf([])).toBeNull();
  });

  it('intersects when touching, contains, expands and unions', () => {
    expect(intersects(box(0, 0, 1, 1), box(1, 1, 2, 2))).toBe(true);
    expect(intersects(box(0, 0, 1, 1), box(1.01, 0, 2, 1))).toBe(false);
    expect(contains(box(0, 0, 10, 10), box(1, 1, 9, 9))).toBe(true);
    expect(contains(box(0, 0, 10, 10), box(1, 1, 11, 9))).toBe(false);
    expect(expand(box(0, 0, 10, 4), 0.5)).toEqual(box(-5, -2, 15, 6));
    expect(union([box(0, 0, 1, 1), null, box(-1, 2, 0, 3)])).toEqual(box(-1, 0, 1, 3));
    expect(union([])).toBeNull();
  });
});

describe('culling', () => {
  interface Item {
    id: string;
    r: Rect | null;
  }
  const items: Record<string, Item> = {
    a: { id: 'a', r: box(0, 0, 1, 1) },
    b: { id: 'b', r: box(5, 5, 6, 6) },
    c: { id: 'c', r: box(-3, -3, -2, -2) },
    empty: { id: 'empty', r: null },
  };

  it('returns the items whose bounds intersect the view', () => {
    const cull = createCuller((item: Item) => item.r);
    expect(cull(items, box(0.5, 0.5, 5.5, 5.5)).map((i) => i.id)).toEqual(['a', 'b']);
    expect(cull(items, box(-10, -10, -2.5, -2.5)).map((i) => i.id)).toEqual(['c']);
    expect(cull(items, box(100, 100, 101, 101))).toEqual([]);
  });

  it('measures each item object once, and again only after it is replaced', () => {
    const bounds = vi.fn((item: Item) => item.r);
    const cull = createCuller(bounds);
    cull(items, box(0, 0, 1, 1));
    cull(items, box(5, 5, 6, 6));
    expect(bounds).toHaveBeenCalledTimes(4);
    cull({ ...items, a: { id: 'a', r: box(9, 9, 10, 10) } }, box(9, 9, 10, 10));
    expect(bounds).toHaveBeenCalledTimes(5);
  });

  it('returns the previous array while the same items of the same collection are visible', () => {
    const cull = createCuller((item: Item) => item.r);
    const first = cull(items, box(0.5, 0.5, 5.5, 5.5));
    expect(cull(items, box(0, 0, 6, 6))).toBe(first);
    const other = cull(items, box(-10, -10, 6, 6));
    expect(other).not.toBe(first);
    expect(other.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    const copy = { ...items };
    expect(cull(copy, box(-10, -10, 6, 6))).not.toBe(other);
    expect(cull(items, box(-10, -10, 6, 6))).toBe(other);
  });

  it('finds the walls in a corner of the busiest large floor in well under a millisecond', () => {
    const model = generateProject('large');
    const floor = Object.values(model.floors).reduce((a, b) =>
      Object.keys(b.data.devices).length > Object.keys(a.data.devices).length ? b : a,
    );
    const walls = floor.data.walls;
    const all = Object.values(walls);
    const extent = union(all.map(wallBounds))!;
    const corner = box(extent.minX, extent.minY, extent.minX + 10, extent.minY + 10);
    const cull = createCuller(wallBounds);

    const visible = cull(walls, corner);
    expect(visible).toHaveLength(all.filter((w) => intersects(wallBounds(w)!, corner)).length);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(all.length / 4);

    const start = performance.now();
    for (let i = 0; i < 100; i++) cull(walls, corner);
    expect((performance.now() - start) / 100).toBeLessThan(1);
  });
});
