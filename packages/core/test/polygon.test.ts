import { describe, expect, it } from 'vitest';
import { centroid, pointInPolygon, polygonProblem, signedArea } from '../src/index.ts';

const square = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

describe('polygons', () => {
  it('computes area, centroid and containment', () => {
    expect(Math.abs(signedArea(square))).toBe(4);
    expect(centroid(square)).toEqual({ x: 1, y: 1 });
    expect(pointInPolygon({ x: 1, y: 1 }, square)).toBe(true);
    expect(pointInPolygon({ x: 3, y: 1 }, square)).toBe(false);
  });

  it('accepts a valid polygon, including a concave one', () => {
    expect(polygonProblem(square)).toBeNull();
    expect(
      polygonProblem([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 2, y: 2 },
        { x: 0, y: 4 },
      ]),
    ).toBeNull();
  });

  it.each([
    [
      'too-few-points',
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    ],
    [
      'repeated-point',
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    ],
    [
      'zero-area',
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
    ],
    [
      'self-intersecting',
      [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
      ],
    ],
  ] as const)('reports %s', (problem, polygon) => {
    expect(polygonProblem(polygon)).toBe(problem);
  });
});
