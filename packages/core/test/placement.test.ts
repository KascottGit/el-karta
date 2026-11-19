import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  putSpaceItem,
  resolvePlacement,
  validateModel,
  type Model,
  type Wall,
} from '../src/index.ts';
import { ModelBuilder } from './builder.ts';

function wallSetup() {
  const b = new ModelBuilder(2);
  const wall = b.wall(1, { x: 0, y: 0 }, { x: 4, y: 0 }, 0.2);
  const room = b.room(
    1,
    [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ],
    { ceilingHeight: 2.7 },
  );
  const left = b.device(1, 'outlet', {
    kind: 'wall',
    wallId: wall.id,
    offset: 1,
    height: 0.3,
    side: 'left',
  });
  const right = b.device(1, 'outlet', {
    kind: 'wall',
    wallId: wall.id,
    offset: 3.5,
    height: 0.3,
    side: 'right',
  });
  const light = b.device(1, 'light', { kind: 'ceiling', roomId: room.id, at: { x: 2, y: 1.5 } });
  const panel = b.device(1, 'panel', { kind: 'floor', at: { x: 0.5, y: 2 } });
  const breaker = b.device(1, 'breaker', { kind: 'container', parentId: panel.id, slot: 0 });
  return {
    b,
    model: b.build(),
    floorId: b.floors[1]!.id,
    wall,
    room,
    left,
    right,
    light,
    panel,
    breaker,
  };
}

const resolve = (model: Model, floorId: string, deviceId: string) => {
  const floor = model.floors[floorId]!;
  return resolvePlacement(floor.data, floor.data.devices[deviceId]!);
};

describe('resolvePlacement', () => {
  it('puts wall devices on the requested face, at height above the floor elevation', () => {
    const { model, floorId, left, right } = wallSetup();
    expect(resolve(model, floorId, left.id)).toEqual({
      ok: true,
      position: { x: 1, y: -0.1, z: 3.3 },
    });
    expect(resolve(model, floorId, right.id)).toEqual({
      ok: true,
      position: { x: 3.5, y: 0.1, z: 3.3 },
    });
  });

  it('uses the room ceiling height, falling back to the floor height', () => {
    const { model, floorId, light, room } = wallSetup();
    expect(resolve(model, floorId, light.id)).toEqual({
      ok: true,
      position: { x: 2, y: 1.5, z: 5.7 },
    });
    delete (model.floors[floorId]!.data.rooms[room.id] as { ceilingHeight?: number }).ceilingHeight;
    expect(resolve(model, floorId, light.id)).toEqual({
      ok: true,
      position: { x: 2, y: 1.5, z: 5.5 },
    });
  });

  it('resolves floor devices at floor elevation and contained devices at their container', () => {
    const { model, floorId, panel, breaker } = wallSetup();
    expect(resolve(model, floorId, panel.id)).toEqual({
      ok: true,
      position: { x: 0.5, y: 2, z: 3 },
    });
    expect(resolve(model, floorId, breaker.id)).toEqual(resolve(model, floorId, panel.id));
  });

  it('reports missing references and container cycles', () => {
    const b = new ModelBuilder();
    const missingWall = b.device(0, 'outlet', {
      kind: 'wall',
      wallId: b.id(),
      offset: 0,
      height: 0,
      side: 'left',
    });
    const missingRoom = b.device(0, 'light', {
      kind: 'ceiling',
      roomId: b.id(),
      at: { x: 0, y: 0 },
    });
    const orphan = b.device(0, 'breaker', { kind: 'container', parentId: b.id(), slot: 0 });
    const model = b.build();
    const floorId = b.floors[0]!.id;
    const a = b.id();
    const c = b.id();
    const data = model.floors[floorId]!.data;
    data.devices[a] = {
      ...data.devices[orphan.id]!,
      id: a,
      placement: { kind: 'container', parentId: c, slot: 0 },
    };
    data.devices[c] = {
      ...data.devices[orphan.id]!,
      id: c,
      placement: { kind: 'container', parentId: a, slot: 0 },
    };

    expect(resolve(model, floorId, missingWall.id)).toMatchObject({
      ok: false,
      problem: { code: 'wall-missing' },
    });
    expect(resolve(model, floorId, missingRoom.id)).toMatchObject({
      ok: false,
      problem: { code: 'room-missing' },
    });
    expect(resolve(model, floorId, orphan.id)).toMatchObject({
      ok: false,
      problem: { code: 'parent-missing' },
    });
    expect(resolve(model, floorId, a)).toMatchObject({
      ok: false,
      problem: { code: 'container-cycle' },
    });
  });
});

describe('wall edits', () => {
  const editWall = (model: Model, floorId: string, wall: Wall, changes: Partial<Wall>) =>
    applyEdit(model, putSpaceItem(floorId, 'walls', { ...wall, ...changes })).model;

  it('moves wall-placed devices with a moved wall', () => {
    const { model, floorId, wall, left } = wallSetup();
    const moved = editWall(model, floorId, wall, { a: { x: 0, y: 5 }, b: { x: 4, y: 5 } });
    expect(resolve(moved, floorId, left.id)).toEqual({
      ok: true,
      position: { x: 1, y: 4.9, z: 3.3 },
    });
  });

  it('follows a rotated wall', () => {
    const { model, floorId, wall, left } = wallSetup();
    const rotated = editWall(model, floorId, wall, { b: { x: 0, y: 4 } });
    const result = resolve(rotated, floorId, left.id);
    expect(result.ok && result.position.x).toBeCloseTo(0.1);
    expect(result.ok && result.position.y).toBeCloseTo(1);
  });

  it('flags devices beyond the end of a shortened wall instead of moving them', () => {
    const { model, floorId, wall, left, right } = wallSetup();
    const shortened = editWall(model, floorId, wall, { b: { x: 3, y: 0 } });

    expect(resolve(shortened, floorId, left.id)).toEqual({
      ok: true,
      position: { x: 1, y: -0.1, z: 3.3 },
    });
    const flagged = resolve(shortened, floorId, right.id);
    expect(flagged).toMatchObject({
      ok: false,
      problem: { code: 'offset-beyond-wall', offset: 3.5, wallLength: 3 },
      approximate: { x: 3, y: 0.1, z: 3.3 },
    });
    expect(shortened.floors[floorId]!.data.devices[right.id]!.placement).toMatchObject({
      offset: 3.5,
    });
    expect(validateModel(shortened)).toEqual([
      expect.objectContaining({
        code: 'placement.offset-beyond-wall',
        severity: 'warning',
        ids: [right.id],
      }),
    ]);
  });
});
