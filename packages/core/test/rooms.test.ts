import { describe, expect, it } from 'vitest';
import { roomAt, roomsBesideWall, type Pt } from '../src/index.ts';
import { ModelBuilder } from './builder.ts';

const pt = (x: number, y: number): Pt => ({ x, y });
const rect = (x0: number, y0: number, x1: number, y1: number) => [
  pt(x0, y0),
  pt(x1, y0),
  pt(x1, y1),
  pt(x0, y1),
];

/** Two rooms side by side on centrelines, a corridor below both, and a wall outside them. */
function plan() {
  const b = new ModelBuilder();
  const left = b.room(0, rect(0, 0, 4, 3));
  const right = b.room(0, rect(4, 0, 8, 3));
  const corridor = b.room(0, rect(0, 3, 8, 5));
  const top = b.wall(0, pt(0, 0), pt(4, 0));
  const between = b.wall(0, pt(4, 0), pt(4, 3));
  const long = b.wall(0, pt(8, 3), pt(0, 3));
  const outside = b.wall(0, pt(10, 0), pt(10, 3));
  const floor = b.build().floors[b.floors[0]!.id]!.data;
  return { floor, left, right, corridor, top, between, long, outside };
}

describe('roomAt', () => {
  it('finds the smallest room containing a point', () => {
    const b = new ModelBuilder();
    b.room(0, rect(0, 0, 10, 10));
    const small = b.room(0, rect(1, 1, 3, 3));
    const floor = b.build().floors[b.floors[0]!.id]!.data;
    expect(roomAt(floor, pt(2, 2))).toBe(small.id);
    expect(roomAt(floor, pt(12, 2))).toBeUndefined();
  });
});

describe('roomsBesideWall', () => {
  it('gives one room for an outer wall, on the face towards it', () => {
    const { floor, top, left } = plan();
    // a→b runs +x and y is down, so the room (y > 0) is on the right face.
    expect(roomsBesideWall(floor, top.id)).toEqual([{ roomId: left.id, side: 'right' }]);
  });

  it('gives both rooms for a wall between two rooms', () => {
    const { floor, between, left, right } = plan();
    expect(roomsBesideWall(floor, between.id)).toEqual([
      { roomId: right.id, side: 'left' },
      { roomId: left.id, side: 'right' },
    ]);
  });

  it('finds every room along a long wall, in order from a', () => {
    const { floor, long, left, right, corridor } = plan();
    const found = roomsBesideWall(floor, long.id);
    expect(found).toHaveLength(3);
    expect(found).toContainEqual({ roomId: corridor.id, side: 'left' });
    const above = found.filter((r) => r.side === 'right').map((r) => r.roomId);
    expect(above).toEqual([right.id, left.id]);
  });

  it('gives nothing for a wall in no room or an unknown wall', () => {
    const { floor, outside } = plan();
    expect(roomsBesideWall(floor, outside.id)).toEqual([]);
    expect(roomsBesideWall(floor, 'missing')).toEqual([]);
  });

  it('finds rooms drawn on the wall faces, not only on centrelines', () => {
    const b = new ModelBuilder();
    const wall = b.wall(0, pt(0, 0), pt(4, 0), 0.3);
    const room = b.room(0, rect(0.15, 0.15, 3.85, 3));
    const floor = b.build().floors[b.floors[0]!.id]!.data;
    expect(roomsBesideWall(floor, wall.id)).toEqual([{ roomId: room.id, side: 'right' }]);
  });
});
