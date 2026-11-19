import { describe, expect, it } from 'vitest';
import {
  fillRoom,
  generateProject,
  polygonProblem,
  signedArea,
  wallFaces,
  type Pt,
  type Wall,
} from '../src/index.ts';
import { ModelBuilder } from './builder.ts';

const pt = (x: number, y: number): Pt => ({ x, y });

/** Builds walls from polylines of [x, y] corners. */
function wallsOf(...polylines: [number, number][][]): Record<string, Wall> {
  const b = new ModelBuilder();
  for (const line of polylines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1]!;
      const [bx, by] = line[i]!;
      b.wall(0, pt(ax, ay), pt(bx, by));
    }
  }
  return b.build().floors[b.floors[0]!.id]!.data.walls;
}

/** Rotates the polygon to start at its smallest (x, y) corner, so results compare with toEqual. */
function normalized(polygon: Pt[] | null): [number, number][] | null {
  if (!polygon) return null;
  const rounded = polygon.map((p): [number, number] => [
    Number(p.x.toFixed(6)) + 0,
    Number(p.y.toFixed(6)) + 0,
  ]);
  let start = 0;
  rounded.forEach(([x, y], i) => {
    const [sx, sy] = rounded[start]!;
    if (x < sx || (x === sx && y < sy)) start = i;
  });
  return [...rounded.slice(start), ...rounded.slice(0, start)];
}

const fill = (walls: Record<string, Wall>, x: number, y: number) =>
  normalized(fillRoom(walls, pt(x, y)));

describe('fill room', () => {
  it('fills a rectangle along the wall centrelines', () => {
    const walls = wallsOf([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
      [0, 0],
    ]);
    expect(fill(walls, 1, 1)).toEqual([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]);
  });

  it('gives a polygon that passes validation and has positive area', () => {
    const walls = wallsOf([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
      [0, 0],
    ]);
    const polygon = fillRoom(walls, pt(2, 2))!;
    expect(polygonProblem(polygon)).toBeNull();
    expect(signedArea(polygon)).toBeCloseTo(12);
  });

  it('fills an L-shaped room', () => {
    const walls = wallsOf([
      [0, 0],
      [6, 0],
      [6, 2],
      [3, 2],
      [3, 5],
      [0, 5],
      [0, 0],
    ]);
    expect(fill(walls, 1, 4)).toEqual([
      [0, 0],
      [6, 0],
      [6, 2],
      [3, 2],
      [3, 5],
      [0, 5],
    ]);
  });

  it('joins ends within a centimetre, including walls drawn in any direction', () => {
    const walls = wallsOf(
      [
        [0, 0],
        [4, 0.004],
      ],
      [
        [4, 3],
        [4.006, 0.008],
      ],
      [
        [4, 3],
        [0, 3],
      ],
      [
        [0.009, 0],
        [0, 3],
      ],
    );
    const polygon = fillRoom(walls, pt(2, 1.5));
    expect(polygon).toHaveLength(4);
    expect(polygonProblem(polygon!)).toBeNull();
  });

  it('gives no room when the walls leave a gap', () => {
    const walls = wallsOf([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
      [0, 0.02],
    ]);
    expect(fillRoom(walls, pt(2, 1.5))).toBeNull();
  });

  it('gives no room outside the walls or with no walls', () => {
    const walls = wallsOf([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
      [0, 0],
    ]);
    expect(fillRoom(walls, pt(5, 1))).toBeNull();
    expect(fillRoom({}, pt(0, 0))).toBeNull();
  });

  it('splits rooms at a T-junction wall', () => {
    // A partition from the top wall to the bottom wall makes two rooms out of one box.
    const walls = wallsOf(
      [
        [0, 0],
        [6, 0],
        [6, 3],
        [0, 3],
        [0, 0],
      ],
      [
        [2, 0],
        [2, 3],
      ],
    );
    expect(fill(walls, 1, 1)).toEqual([
      [0, 0],
      [2, 0],
      [2, 3],
      [0, 3],
    ]);
    expect(fill(walls, 4, 1)).toEqual([
      [2, 0],
      [6, 0],
      [6, 3],
      [2, 3],
    ]);
  });

  it("leaves out the corner where a neighbour's wall meets a room's side", () => {
    // The right half is split in two; the left room's side has a T-junction at (3, 2).
    const walls = wallsOf(
      [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
        [0, 0],
      ],
      [
        [3, 0],
        [3, 4],
      ],
      [
        [3, 2],
        [6, 2],
      ],
    );
    expect(fill(walls, 1, 1)).toEqual([
      [0, 0],
      [3, 0],
      [3, 4],
      [0, 4],
    ]);
    expect(fill(walls, 5, 3)).toEqual([
      [3, 2],
      [6, 2],
      [6, 4],
      [3, 4],
    ]);
  });

  it('splits walls that cross each other', () => {
    const walls = wallsOf(
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 0],
      ],
      [
        [2, -1],
        [2, 5],
      ],
      [
        [-1, 2],
        [5, 2],
      ],
    );
    expect(fill(walls, 3, 3)).toEqual([
      [2, 2],
      [4, 2],
      [4, 4],
      [2, 4],
    ]);
  });

  it('ignores a wall stub that ends inside the room', () => {
    const walls = wallsOf(
      [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
        [0, 0],
      ],
      [
        [4, 1.5],
        [2.5, 1.5],
      ],
    );
    expect(fill(walls, 1, 1)).toEqual([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]);
  });

  it('picks the room tapped among rooms that share walls', () => {
    const { floors } = generateProject('small');
    const floor = Object.values(floors)[0]!;
    for (const room of Object.values(floor.data.rooms)) {
      const [min, , max] = room.polygon as [Pt, Pt, Pt];
      const inside = pt((min.x + max.x) / 2 + 0.3, (min.y + max.y) / 2 + 0.2);
      expect(normalized(fillRoom(floor.data.walls, inside))).toEqual(normalized(room.polygon));
    }
  });

  it('finds a room inside a room as a separate face', () => {
    const walls = wallsOf(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
        [4, 4],
      ],
    );
    expect(fill(walls, 5, 5)).toEqual([
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
    ]);
    expect(fill(walls, 1, 1)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });

  it('only returns bounded faces, each once', () => {
    const walls = wallsOf(
      [
        [0, 0],
        [6, 0],
        [6, 3],
        [0, 3],
        [0, 0],
      ],
      [
        [2, 0],
        [2, 3],
      ],
    );
    const faces = wallFaces(walls);
    expect(faces.map((f) => Math.round(f.area)).sort()).toEqual([12, 6]);
  });

  it('builds the faces of a large floor quickly', () => {
    const { floors } = generateProject('large');
    const floor = Object.values(floors)[0]!;
    const start = performance.now();
    const faces = wallFaces(floor.data.walls);
    const elapsed = performance.now() - start;
    expect(faces).toHaveLength(Object.keys(floor.data.rooms).length);
    expect(elapsed).toBeLessThan(50);
  });
});
