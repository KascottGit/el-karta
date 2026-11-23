import { describe, expect, it } from 'vitest';
import type { MarkerShape } from './appearance';
import { markerSubpath, type PathContext } from './marker-path';

const SHAPES: readonly MarkerShape[] = ['circle', 'square', 'diamond', 'triangle'];

function trace(shape: MarkerShape, x: number, y: number, r: number) {
  const calls: string[] = [];
  const points: [number, number][] = [];
  const context: PathContext = {
    moveTo: (px, py) => {
      calls.push('move');
      points.push([px, py]);
    },
    lineTo: (px, py) => {
      calls.push('line');
      points.push([px, py]);
    },
    arc: (cx, cy, radius) => {
      calls.push('arc');
      points.push([cx, cy + radius], [cx - radius, cy]);
    },
    closePath: () => calls.push('close'),
  };
  markerSubpath(context, shape, x, y, r);
  return { calls, points };
}

describe('markerSubpath', () => {
  it('adds one closed subpath per marker, starting with a move so markers stay apart', () => {
    expect(trace('circle', 0, 0, 6).calls).toEqual(['move', 'arc', 'close']);
    expect(trace('square', 0, 0, 6).calls).toEqual(['move', 'line', 'line', 'line', 'close']);
    expect(trace('diamond', 0, 0, 6).calls).toEqual(['move', 'line', 'line', 'line', 'close']);
    expect(trace('triangle', 0, 0, 6).calls).toEqual(['move', 'line', 'line', 'close']);
  });

  it('fits every shape in the circle of the given radius around its centre', () => {
    for (const shape of SHAPES) {
      const reach = (r: number) =>
        Math.max(...trace(shape, 2, 3, r).points.map(([x, y]) => Math.hypot(x - 2, y - 3)));
      expect(reach(6), shape).toBeCloseTo(6);
      expect(reach(0.06), shape).toBeCloseTo(0.06);
    }
  });
});
