import { describe, expect, it } from 'vitest';
import {
  centroid,
  closestOnSegment,
  insertVertex,
  moveVertex,
  pointInPolygon,
  polygonProblem,
  removeVertex,
  samePolygon,
  signedArea,
  withoutCollinear,
} from '../src/index.ts';

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

describe('vertex editing', () => {
  it('moves one vertex and leaves the input untouched', () => {
    const moved = moveVertex(square, 2, { x: 3, y: 3 });
    expect(moved).toEqual([square[0], square[1], { x: 3, y: 3 }, square[3]]);
    expect(square[2]).toEqual({ x: 2, y: 2 });
  });

  it('inserts a vertex after the given one, including on the closing edge', () => {
    expect(insertVertex(square, 0, { x: 1, y: 0 })).toEqual([
      square[0],
      { x: 1, y: 0 },
      square[1],
      square[2],
      square[3],
    ]);
    expect(insertVertex(square, 3, { x: 0, y: 1 })).toEqual([...square, { x: 0, y: 1 }]);
  });

  it('removes a vertex but keeps at least three', () => {
    const pentagon = insertVertex(square, 0, { x: 1, y: -1 });
    expect(removeVertex(pentagon, 1)).toEqual(square);
    expect(removeVertex(square, 0)).toEqual([square[1], square[2], square[3]]);
    expect(removeVertex(square.slice(0, 3), 0)).toBeNull();
  });

  it('drops collinear and repeated points but not a corner', () => {
    expect(
      withoutCollinear([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
        { x: 0, y: 1 },
      ]),
    ).toEqual(square);
    expect(withoutCollinear(square)).toEqual(square);
  });

  it('keeps a point where the outline doubles back on itself', () => {
    const spike = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(withoutCollinear(spike)).toContainEqual({ x: 3, y: 2 });
  });
});

describe('closest point on a segment', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 4, y: 0 };
  it('projects onto the segment and clamps to its ends', () => {
    expect(closestOnSegment({ x: 1, y: 2 }, a, b)).toEqual({ point: { x: 1, y: 0 }, t: 0.25 });
    expect(closestOnSegment({ x: -3, y: 1 }, a, b)).toEqual({ point: a, t: 0 });
    expect(closestOnSegment({ x: 9, y: 1 }, a, b)).toEqual({ point: b, t: 1 });
    expect(closestOnSegment({ x: 9, y: 1 }, a, a).point).toEqual(a);
  });
});

describe('same polygon', () => {
  it('matches from any start and in either direction', () => {
    expect(samePolygon(square, [square[2]!, square[3]!, square[0]!, square[1]!])).toBe(true);
    expect(samePolygon(square, [...square].reverse())).toBe(true);
    expect(samePolygon(square, [square[0]!, square[2]!, square[1]!, square[3]!])).toBe(false);
    expect(samePolygon(square, square.slice(0, 3))).toBe(false);
  });
});
