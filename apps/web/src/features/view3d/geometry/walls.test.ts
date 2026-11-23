import { describe, expect, it } from 'vitest';
import type { WallPiece } from './types';
import { wallPieces } from './walls';
import { FloorFixture, pt } from './test-fixtures';

const r = (v: number) => Math.round(v * 1000) / 1000;

/** Pieces of a wall running along +x from x = 0, as [from, to] along it and [bottom, top]. */
const spans = (pieces: readonly WallPiece[]) =>
  pieces
    .map((p) => ({
      along: [r(p.center.x - p.size.x / 2), r(p.center.x + p.size.x / 2)],
      z: [r(p.center.z - p.size.z / 2), r(p.center.z + p.size.z / 2)],
    }))
    .sort((p, q) => p.along[0]! - q.along[0]! || p.z[0]! - q.z[0]!);

function straightWall(height?: number) {
  const floor = new FloorFixture(2.5);
  const wall = floor.wall(pt(0, 0), pt(4, 0), height === undefined ? {} : { height });
  return { floor, wall };
}

describe('wallPieces', () => {
  it('is one box along the centreline without openings', () => {
    const floor = new FloorFixture(2.5);
    const wall = floor.wall(pt(1, 1), pt(1, 4), { thickness: 0.3 });
    expect(wallPieces(floor.data)).toEqual([
      {
        wallId: wall.id,
        center: { x: 1, y: 2.5, z: 1.25 },
        size: { x: 3, y: 0.3, z: 2.5 },
        rotation: Math.PI / 2,
      },
    ]);
  });

  it('leaves a lintel above a door', () => {
    const { floor, wall } = straightWall();
    floor.opening(wall.id, 'door', 1, 0.9, 2.1);
    expect(spans(wallPieces(floor.data))).toEqual([
      { along: [0, 1], z: [0, 2.5] },
      { along: [1, 1.9], z: [2.1, 2.5] },
      { along: [1.9, 4], z: [0, 2.5] },
    ]);
  });

  it('leaves a sill piece under a window and a lintel above it', () => {
    const { floor, wall } = straightWall();
    floor.opening(wall.id, 'window', 2, 1.2, 1.2, 0.9);
    expect(spans(wallPieces(floor.data))).toEqual([
      { along: [0, 2], z: [0, 2.5] },
      { along: [2, 3.2], z: [0, 0.9] },
      { along: [2, 3.2], z: [2.1, 2.5] },
      { along: [3.2, 4], z: [0, 2.5] },
    ]);
  });

  it('cuts two openings with a full-height piece between them', () => {
    const { floor, wall } = straightWall();
    floor.opening(wall.id, 'window', 2.5, 1, 1, 1);
    floor.opening(wall.id, 'door', 0.5, 1, 2.1);
    expect(spans(wallPieces(floor.data))).toEqual([
      { along: [0, 0.5], z: [0, 2.5] },
      { along: [0.5, 1.5], z: [2.1, 2.5] },
      { along: [1.5, 2.5], z: [0, 2.5] },
      { along: [2.5, 3.5], z: [0, 1] },
      { along: [2.5, 3.5], z: [2, 2.5] },
      { along: [3.5, 4], z: [0, 2.5] },
    ]);
  });

  it('cuts overlapping openings as their union', () => {
    const { floor, wall } = straightWall();
    floor.opening(wall.id, 'door', 1, 1, 2.1);
    floor.opening(wall.id, 'window', 1.5, 1, 1, 1);
    expect(spans(wallPieces(floor.data))).toEqual([
      { along: [0, 1], z: [0, 2.5] },
      { along: [1, 2], z: [2.1, 2.5] },
      { along: [2, 2.5], z: [0, 1] },
      { along: [2, 2.5], z: [2, 2.5] },
      { along: [2.5, 4], z: [0, 2.5] },
    ]);
  });

  it('cuts an opening at a wall end without a zero-length piece', () => {
    const { floor, wall } = straightWall();
    floor.opening(wall.id, 'door', 0, 0.9, 2.1);
    expect(spans(wallPieces(floor.data))).toEqual([
      { along: [0, 0.9], z: [2.1, 2.5] },
      { along: [0.9, 4], z: [0, 2.5] },
    ]);
  });

  it('clamps an opening wider than the wall to the wall', () => {
    const { floor, wall } = straightWall();
    floor.opening(wall.id, 'window', 3, 5, 1, 1);
    const pieces = spans(wallPieces(floor.data));
    expect(pieces).toEqual([
      { along: [0, 3], z: [0, 2.5] },
      { along: [3, 4], z: [0, 1] },
      { along: [3, 4], z: [2, 2.5] },
    ]);
  });

  it('leaves no lintel when an opening reaches the top of the wall', () => {
    const { floor, wall } = straightWall();
    floor.opening(wall.id, 'passage', 1, 1, 3);
    expect(spans(wallPieces(floor.data))).toEqual([
      { along: [0, 1], z: [0, 2.5] },
      { along: [2, 4], z: [0, 2.5] },
    ]);
  });

  it('uses the wall’s own height over the floor’s', () => {
    const { floor, wall } = straightWall(1.1);
    floor.opening(wall.id, 'window', 1, 1, 1.2, 0.9);
    expect(spans(wallPieces(floor.data))).toEqual([
      { along: [0, 1], z: [0, 1.1] },
      { along: [1, 2], z: [0, 0.9] },
      { along: [2, 4], z: [0, 1.1] },
    ]);
  });

  it('ignores openings of other walls', () => {
    const { floor } = straightWall();
    const other = floor.wall(pt(0, 5), pt(4, 5));
    floor.opening(other.id, 'door', 1, 0.9, 2.1);
    const [only] = wallPieces(floor.data).filter((p) => p.center.y === 0);
    expect(only?.size.x).toBe(4);
  });

  it('extends ends that meet another wall’s end, closing an L corner', () => {
    const floor = new FloorFixture();
    const top = floor.wall(pt(0, 0), pt(4, 0), { thickness: 0.2 });
    const side = floor.wall(pt(4.005, 0.005), pt(4, 3), { thickness: 0.3 });
    const pieces = wallPieces(floor.data);
    const topPiece = pieces.find((p) => p.wallId === top.id)!;
    const sidePiece = pieces.find((p) => p.wallId === side.id)!;
    expect(r(topPiece.size.x)).toBe(4.1);
    expect(r(topPiece.center.x)).toBe(2.05);
    expect(r(sidePiece.size.y)).toBe(0.3);
    expect(r(sidePiece.size.x)).toBe(r(Math.hypot(0.005, 2.995) + 0.15));
  });

  it('extends the stem of a T built from three wall ends, not the straight crossbar', () => {
    const floor = new FloorFixture();
    floor.wall(pt(0, 0), pt(2, 0));
    floor.wall(pt(2, 0), pt(4, 0));
    floor.wall(pt(2, 0), pt(2, 3));
    expect(wallPieces(floor.data).map((p) => r(p.size.x))).toEqual([2, 2, 3.1]);
  });

  it('does not extend a wall into a straight continuation, so a door at the joint stays open', () => {
    const floor = new FloorFixture();
    floor.wall(pt(0, 0), pt(2, 0));
    const second = floor.wall(pt(2, 0), pt(4, 0));
    floor.opening(second.id, 'door', 0, 0.9, 2.1);
    const pieces = wallPieces(floor.data);
    const inDoor = pieces.filter(
      (p) =>
        p.center.z - p.size.z / 2 < 2.1 - 1e-9 &&
        p.center.x + p.size.x / 2 > 2 + 1e-9 &&
        p.center.x - p.size.x / 2 < 2.9,
    );
    expect(inDoor).toEqual([]);
  });

  it('leaves an end on the middle of another wall as it is, since it already reaches into it', () => {
    const floor = new FloorFixture();
    floor.wall(pt(0, 0), pt(4, 0));
    const stem = floor.wall(pt(2, 0), pt(2, 3));
    const piece = wallPieces(floor.data).find((p) => p.wallId === stem.id)!;
    expect(piece.size.x).toBe(3);
  });

  it('does not extend free ends', () => {
    const floor = new FloorFixture();
    floor.wall(pt(0, 0), pt(4, 0));
    floor.wall(pt(4.5, 0), pt(8, 0));
    expect(wallPieces(floor.data).map((p) => r(p.size.x))).toEqual([4, 3.5]);
  });

  it('keeps the extension solid when an opening starts at a joined end', () => {
    const floor = new FloorFixture();
    const top = floor.wall(pt(0, 0), pt(4, 0));
    floor.wall(pt(0, 3), pt(0, 0));
    floor.opening(top.id, 'door', 0, 0.9, 2.1);
    expect(spans(wallPieces(floor.data).filter((p) => p.wallId === top.id))).toEqual([
      { along: [-0.1, 0], z: [0, 2.5] },
      { along: [0, 0.9], z: [2.1, 2.5] },
      { along: [0.9, 4], z: [0, 2.5] },
    ]);
  });

  it('skips walls of zero length', () => {
    const floor = new FloorFixture();
    floor.wall(pt(1, 1), pt(1, 1));
    expect(wallPieces(floor.data)).toEqual([]);
  });
});
