import { applyEdit, generateProject, type FloorRecord } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { createModelStore } from '@/model/store';
import { deleteSelection, selectedIds, toggleItem, type SelectionItem } from './selection';

function setup() {
  const model = generateProject('small');
  const floor = Object.values(model.floors).find((f) =>
    Object.values(f.data.openings).some((o) => o.wallId in f.data.walls),
  )!;
  const opening = Object.values(floor.data.openings)[0]!;
  const wall = floor.data.walls[opening.wallId]!;
  const room = Object.values(floor.data.rooms)[0]!;
  return { model, floor, opening, wall, room };
}

const floorAfter = (model: ReturnType<typeof generateProject>, floor: FloorRecord) =>
  model.floors[floor.id]!.data;

describe('selection', () => {
  it('toggles items and lists the ids of one collection', () => {
    const a: SelectionItem = { collection: 'walls', id: 'a' };
    const b: SelectionItem = { collection: 'rooms', id: 'b' };
    const both = toggleItem(toggleItem([], a), b);
    expect(both).toEqual([a, b]);
    expect(toggleItem(both, { collection: 'walls', id: 'a' })).toEqual([b]);
    expect([...selectedIds(both, 'walls')]).toEqual(['a']);
  });

  it('deletes a wall together with a selected opening on it, and a room, in one edit', () => {
    const { model, floor, opening, wall, room } = setup();
    const edit = deleteSelection(floor, [
      { collection: 'walls', id: wall.id },
      { collection: 'openings', id: opening.id },
      { collection: 'rooms', id: room.id },
      { collection: 'walls', id: wall.id },
    ])!;
    const data = floorAfter(applyEdit(model, edit).model, floor);
    expect(data.walls[wall.id]).toBeUndefined();
    expect(data.openings[opening.id]).toBeUndefined();
    expect(data.rooms[room.id]).toBeUndefined();
    expect(Object.keys(data.walls)).toHaveLength(Object.keys(floor.data.walls).length - 1);
  });

  it('deletes devices and skips items that are no longer on the floor', () => {
    const { model, floor } = setup();
    const device = Object.values(floor.data.devices).find((d) => d.type === 'outlet')!;
    expect(
      deleteSelection(floor, [
        { collection: 'walls', id: crypto.randomUUID() },
        { collection: 'rooms', id: crypto.randomUUID() },
      ]),
    ).toBeNull();
    expect(deleteSelection(floor, [])).toBeNull();
    const edit = deleteSelection(floor, [
      { collection: 'devices', id: device.id },
      { collection: 'zones', id: crypto.randomUUID() },
    ])!;
    expect(floorAfter(applyEdit(model, edit).model, floor).devices[device.id]).toBeUndefined();
  });

  it('is undone as a single step', () => {
    const { model, floor, wall, room } = setup();
    const store = createModelStore();
    store.getState().load(model);
    store.getState().apply(
      deleteSelection(floor, [
        { collection: 'walls', id: wall.id },
        { collection: 'rooms', id: room.id },
      ])!,
    );
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().model).toEqual(model);
  });
});
