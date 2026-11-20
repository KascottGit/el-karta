import { describe, expect, it } from 'vitest';
import {
  fitRect,
  MAX_SCALE,
  MIN_SCALE,
  nextRenderWindow,
  panBy,
  pinchStep,
  screenToWorld,
  visibleRect,
  worldToScreen,
  zoomAt,
  type Viewport,
} from './viewport';

const vp: Viewport = { x: 100, y: -50, scale: 20 };
const size = { width: 800, height: 600 };

const expectPt = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
};

describe('world ↔ screen transform', () => {
  it('maps metres to pixels with y down and inverts exactly', () => {
    expect(worldToScreen(vp, { x: 2, y: 3 })).toEqual({ x: 140, y: 10 });
    expect(screenToWorld(vp, { x: 140, y: 10 })).toEqual({ x: 2, y: 3 });
    const p = { x: -12.34, y: 56.78 };
    expectPt(screenToWorld(vp, worldToScreen(vp, p)), p);
  });

  it('pans by screen pixels', () => {
    const moved = panBy(vp, 30, -20);
    expect(moved).toEqual({ x: 130, y: -70, scale: 20 });
    expectPt(worldToScreen(moved, { x: 2, y: 3 }), { x: 170, y: -10 });
  });

  it('zooms about the anchor, keeping the world point under it in place', () => {
    const anchor = { x: 321, y: 123 };
    const world = screenToWorld(vp, anchor);
    const zoomed = zoomAt(vp, anchor, 2.5);
    expect(zoomed.scale).toBe(50);
    expectPt(worldToScreen(zoomed, world), anchor);
  });

  it('clamps the scale', () => {
    expect(zoomAt(vp, { x: 0, y: 0 }, 1e9).scale).toBe(MAX_SCALE);
    expect(zoomAt(vp, { x: 0, y: 0 }, 1e-9).scale).toBe(MIN_SCALE);
  });
});

describe('pinch', () => {
  it('pans with the midpoint when the fingers keep their distance', () => {
    const next = pinchStep(
      vp,
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 10, y: 20 },
      { x: 110, y: 20 },
    );
    expect(next).toEqual({ x: 110, y: -30, scale: 20 });
  });

  it('zooms by the distance ratio about the midpoint and follows it', () => {
    const world = screenToWorld(vp, { x: 150, y: 100 });
    const next = pinchStep(
      vp,
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 60, y: 200 },
      { x: 260, y: 200 },
    );
    expect(next.scale).toBeCloseTo(40);
    expectPt(worldToScreen(next, world), { x: 160, y: 200 });
  });

  it('ignores a zero distance instead of producing NaN', () => {
    const p = { x: 5, y: 5 };
    expect(pinchStep(vp, p, p, p, p)).toEqual(vp);
  });
});

describe('fit and visible area', () => {
  it('fits a rectangle inside the padded view and centres it', () => {
    const rect = { minX: 0, minY: 0, maxX: 50, maxY: 40 };
    const fitted = fitRect(rect, size, 20);
    expect(fitted.scale).toBeCloseTo(Math.min(760 / 50, 560 / 40));
    expectPt(worldToScreen(fitted, { x: 25, y: 20 }), { x: 400, y: 300 });
    const visible = visibleRect(fitted, size);
    expect(visible.minX).toBeLessThanOrEqual(0);
    expect(visible.maxX).toBeGreaterThanOrEqual(50);
    expect(visible.minY).toBeLessThanOrEqual(0);
    expect(visible.maxY).toBeGreaterThanOrEqual(40);
  });

  it('fits a line by its only extent, and centres the origin when there is nothing', () => {
    const line = fitRect({ minX: 0, minY: 5, maxX: 10, maxY: 5 }, size, 0);
    expect(line.scale).toBe(80);
    expectPt(worldToScreen(line, { x: 5, y: 5 }), { x: 400, y: 300 });
    const empty = fitRect(null, size);
    expectPt(worldToScreen(empty, { x: 0, y: 0 }), { x: 400, y: 300 });
    expect(Number.isFinite(empty.scale)).toBe(true);
  });

  it('reports the visible world rectangle', () => {
    expect(visibleRect(vp, size)).toEqual({ minX: -5, minY: 2.5, maxX: 35, maxY: 32.5 });
  });
});

describe('render window', () => {
  it('keeps the window while small pans and zooms stay inside it', () => {
    const first = nextRenderWindow(null, vp, size);
    const visible = visibleRect(vp, size);
    expect(first.rect.minX).toBeLessThan(visible.minX);
    expect(first.rect.maxY).toBeGreaterThan(visible.maxY);
    expect(nextRenderWindow(first, panBy(vp, 100, 50), size)).toBe(first);
    expect(nextRenderWindow(first, zoomAt(vp, { x: 400, y: 300 }, 1.2), size)).toBe(first);
  });

  it('moves the window once the view leaves it', () => {
    const first = nextRenderWindow(null, vp, size);
    const moved = panBy(vp, -900, 0);
    const next = nextRenderWindow(first, moved, size);
    expect(next).not.toBe(first);
    expect(next.rect.maxX).toBeGreaterThan(visibleRect(moved, size).maxX);
  });

  it('picks a tighter window after zooming far in, so culling still pays off', () => {
    const first = nextRenderWindow(null, vp, size);
    const zoomed = zoomAt(vp, { x: 400, y: 300 }, 4);
    const next = nextRenderWindow(first, zoomed, size);
    expect(next).not.toBe(first);
    expect(next.scale).toBe(zoomed.scale);
  });
});
