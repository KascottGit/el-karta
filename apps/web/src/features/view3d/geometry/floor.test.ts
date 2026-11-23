import { describe, expect, it } from 'vitest';
import { stackedBounds } from './bounds';
import { buildFloorGeometry } from './floor';
import { roomSlabs } from './rooms';
import { floorBases } from './stacking';
import { FloorFixture, pt } from './test-fixtures';

const level = (id: string, elevation: number, height: number) => ({
  id,
  data: { elevation, height },
});

describe('floorBases', () => {
  const floors = [level('two', 2.8, 2.5), level('one', 0, 2.5), level('three', 5.6, 3)];

  it('puts floors at their elevation', () => {
    expect(Object.fromEntries(floorBases(floors, false))).toEqual({ one: 0, two: 2.8, three: 5.6 });
  });

  it('leaves a gap of one floor height between visible floors when exploded', () => {
    expect(Object.fromEntries(floorBases(floors, true))).toEqual({
      one: 0,
      two: 2.8 + 2.5,
      three: 5.6 + 2.5 + 2.5,
    });
  });

  it('only counts the visible floors below for the gap', () => {
    const visible = [floors[1]!, floors[2]!];
    expect(Object.fromEntries(floorBases(visible, true))).toEqual({ one: 0, three: 5.6 + 2.5 });
  });
});

describe('roomSlabs', () => {
  it('is the room polygon, leaving out invalid ones', () => {
    const floor = new FloorFixture();
    const polygon = [pt(0, 0), pt(4, 0), pt(4, 3), pt(0, 3)];
    const room = floor.room(polygon);
    floor.room([pt(0, 0), pt(1, 1)]);
    expect(roomSlabs(floor.data)).toEqual([{ roomId: room.id, outline: polygon }]);
  });
});

describe('buildFloorGeometry', () => {
  it('bounds walls, slabs and devices in floor-local coordinates', () => {
    const floor = new FloorFixture(2.5, 10);
    floor.wall(pt(0, 0), pt(4, 0), { thickness: 0.2 });
    floor.room([pt(0, 0), pt(4, 0), pt(4, 3), pt(0, 3)]);
    floor.device({
      kind: 'floor',
      at: pt(5, 2),
      rotation: 90,
      size: { x: 2, y: 1, z: 3 },
    });
    const { walls, slabs, devices, bounds } = buildFloorGeometry(floor.data);
    expect([walls.length, slabs.length, devices.length]).toEqual([1, 1, 1]);
    expect(bounds?.min).toEqual({ x: 0, y: -0.1, z: 0 });
    expect(bounds?.max.x).toBeCloseTo(5.5);
    expect(bounds?.max.y).toBeCloseTo(3);
    expect(bounds?.max.z).toBe(3);
  });

  it('has no bounds for an empty floor', () => {
    expect(buildFloorGeometry(new FloorFixture().data).bounds).toBeNull();
  });
});

describe('stackedBounds', () => {
  it('raises each floor’s bounds to its base and skips empty floors', () => {
    const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 3, z: 2.5 } };
    expect(
      stackedBounds([
        { bounds: box, base: 0 },
        { bounds: null, base: 100 },
        { bounds: { ...box, max: { x: 6, y: 3, z: 2.5 } }, base: 5.3 },
      ]),
    ).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 6, y: 3, z: 7.8 } });
    expect(stackedBounds([])).toBeNull();
  });
});
