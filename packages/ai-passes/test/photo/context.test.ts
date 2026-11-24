import type { Device, FloorData, Id, Suggestion } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import {
  earlierPhotos,
  pendingOnFloor,
  photoContext,
  roomWalls,
  type PhotoShot,
} from '../../src/index.ts';
import { detectable, id } from './fixtures.ts';
import { kitchenFloor, outlet } from './floor.ts';

const kitchen = () => {
  const { floor, ids } = kitchenFloor();
  return { data: floor.data, ids };
};

describe('roomWalls', () => {
  it('lists the room’s walls clockwise from the photographed one, each with the face into the room', () => {
    const { data, ids } = kitchen();
    const walls = roomWalls(data, ids.kitchen, ids.outer);
    expect(walls.map((w) => w.id)).toEqual([ids.outer, ids.shared, ids.bottom, ids.left]);
    expect(walls.map((w) => w.side)).toEqual(['right', 'right', 'right', 'right']);
    expect(roomWalls(data, ids.kitchen, ids.bottom).map((w) => w.id)).toEqual([
      ids.bottom,
      ids.left,
      ids.outer,
      ids.shared,
    ]);
    // The hall sees the shared wall from its other face.
    expect(roomWalls(data, ids.hall)).toEqual([
      expect.objectContaining({ id: ids.shared, side: 'left' }),
    ]);
  });
});

describe('photoContext', () => {
  it('gives the room, its walls with their openings (hinge and swing kept) and its devices of detectable types', () => {
    const { data, ids } = kitchen();
    const mine = outlet(id(201), ids.outer);
    // Same wall, the hall's face: not in the kitchen.
    const other = outlet(id(202), ids.shared, 1, 'left');
    const sofa = { ...outlet(id(203), ids.outer), domain: 'furnishing', type: 'sofa' };
    data.devices = { [mine.id]: mine, [other.id]: other, [sofa.id]: sofa };
    data.rooms[ids.kitchen]!.ceilingHeight = 2.4;
    const context = photoContext(data, { roomId: ids.kitchen, wallId: ids.outer }, detectable)!;

    expect(context.room).toMatchObject({ id: ids.kitchen, name: 'Kök', ceilingHeight: 2.4 });
    expect(context.walls[0]!.id).toBe(ids.outer);
    expect(context.targetWallId).toBe(ids.outer);
    expect(context.openings).toEqual([
      expect.objectContaining({ id: ids.window, sill: 0.9 }),
      expect.objectContaining({ id: ids.door, hinge: 'left', swing: 'in' }),
    ]);
    expect(context.devices.map((d) => d.id)).toEqual([mine.id]);
    expect(context.detectable).toEqual(detectable);
  });

  it('leaves out devices and openings on the stretch of a wall that faces another room', () => {
    const { data, ids } = kitchen();
    // The top wall runs on past the kitchen (0–4 m) along the hall (4–8 m), on the same face.
    const top = data.walls[ids.outer]!;
    data.walls[ids.outer] = { ...top, b: { x: 8, y: 0 } };
    data.openings[ids.window] = { ...data.openings[ids.window]!, offset: 5.5 };
    const at = (n: number, offset: number): Device => outlet(id(n), ids.outer, offset);
    const [mine, edge, hall] = [at(211, 1), at(212, 4), at(213, 6)];
    data.devices = { [mine.id]: mine, [edge.id]: edge, [hall.id]: hall };
    const context = photoContext(data, { roomId: ids.kitchen, wallId: ids.outer }, detectable)!;
    expect(context.devices.map((d) => d.id).sort()).toEqual([mine.id, edge.id].sort());
    expect(context.openings.map((o) => o.id)).toEqual([ids.door]);
  });

  it('takes the floor height without a room height, and no target for the room in general', () => {
    const { data, ids } = kitchen();
    const context = photoContext(data, { roomId: ids.kitchen }, detectable)!;
    expect(context.room.ceilingHeight).toBe(data.height);
    expect(context.targetWallId).toBeNull();
  });

  it('has none for a room that is gone or has no walls', () => {
    const { data, ids } = kitchen();
    expect(photoContext(data, { roomId: id(299) }, detectable)).toBeNull();
    const bare: FloorData = { ...data, walls: {} };
    expect(photoContext(bare, { roomId: ids.kitchen }, detectable)).toBeNull();
  });
});

describe('earlierPhotos', () => {
  const { ids } = kitchen();
  const at = (hour: number) => `2026-11-24T${String(hour).padStart(2, '0')}:00:00Z`;
  const shot = (n: number, wallId: Id | undefined, hour: number, roomId: Id = ids.kitchen) =>
    ({
      id: `p${String(n)}`,
      region: wallId ? { roomId, wallId } : { roomId },
      createdAt: at(hour),
    }) satisfies PhotoShot;

  it('sends photos of the same wall first, then the most recent, at most three', () => {
    const current = shot(0, ids.outer, 12);
    const photos = [
      shot(1, ids.shared, 11),
      shot(2, ids.outer, 8),
      shot(3, undefined, 10),
      shot(4, ids.outer, 9),
      shot(5, ids.outer, 9, ids.hall),
      current,
    ];
    expect(earlierPhotos(photos, current).map((p) => p.id)).toEqual(['p4', 'p2', 'p1']);
    // A photo of the room in general has no wall to share: the most recent go first.
    const general = shot(6, undefined, 13);
    expect(earlierPhotos([...photos, general], general).map((p) => p.id)).toEqual([
      'p0',
      'p1',
      'p3',
    ]);
    expect(earlierPhotos(photos, { id: 'x', region: null })).toEqual([]);
  });
});

describe('pendingOnFloor', () => {
  const { ids } = kitchen();
  let n = 300;
  const row = (kind: string, payload: unknown, status: Suggestion['status'] = 'pending') =>
    ({ id: id(n++), kind, payload, status }) as Suggestion;

  it('collects pending devices and the openings and rooms with a correction waiting', () => {
    const device = outlet(id(221), ids.outer);
    const result = pendingOnFloor(
      [
        row('device', device),
        row('device', outlet(id(222), ids.outer), 'accepted'),
        row('opening', { id: ids.window }),
        row('room-ceiling-height', { roomId: ids.kitchen, ceilingHeight: 2.5 }),
        row('device', 'unreadable'),
      ],
      (s) => (typeof s.payload === 'object' ? s.payload : null),
    );
    expect(result).toEqual({
      pending: [device],
      pendingCorrections: { openingIds: [ids.window], roomIds: [ids.kitchen] },
    });
  });
});
