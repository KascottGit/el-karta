import {
  addDevice,
  generateProject,
  removeDevice,
  replayChanges,
  updateDevice,
  type Device,
  type Model,
} from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { createModelStore } from './store';

function setup() {
  const model = generateProject('small');
  const floor = Object.values(model.floors).find((f) => f.sortOrder === 1)!;
  const outlet = Object.values(floor.data.devices).find((d) => d.type === 'outlet')!;
  const store = createModelStore();
  store.getState().load(model);
  return { store, model, floor, outlet };
}

const deviceIn = (model: Model | null, floorId: string, id: string) =>
  model?.floors[floorId]?.data.devices[id];

describe('model store', () => {
  it('applies edits and undoes and redoes them in order', () => {
    const { store, model, floor, outlet } = setup();
    const { apply, undo, redo } = store.getState();
    apply(updateDevice(outlet.id, { label: 'Ett' }));
    apply(updateDevice(outlet.id, { label: 'Två' }));
    expect(deviceIn(store.getState().model, floor.id, outlet.id)?.label).toBe('Två');

    undo();
    expect(deviceIn(store.getState().model, floor.id, outlet.id)?.label).toBe('Ett');
    undo();
    expect(store.getState().model).toEqual(model);
    undo();
    expect(store.getState().model).toEqual(model);

    redo();
    redo();
    expect(deviceIn(store.getState().model, floor.id, outlet.id)?.label).toBe('Två');
    expect(store.getState().future).toHaveLength(0);
  });

  it('clears the redo stack when a new edit is made', () => {
    const { store, outlet } = setup();
    const { apply, undo } = store.getState();
    apply(updateDevice(outlet.id, { label: 'Ett' }));
    undo();
    apply(updateDevice(outlet.id, { label: 'Annat' }));
    expect(store.getState().future).toHaveLength(0);
    expect(store.getState().past).toHaveLength(1);
  });

  it('undoes a cascading removal across floors in one step', () => {
    const { store, model } = setup();
    const panel = Object.values(model.floors)
      .flatMap((f) => Object.values(f.data.devices))
      .find((d) => d.type === 'main_panel')!;
    store.getState().apply(removeDevice(panel.id));
    expect(Object.keys(store.getState().model!.project.data.crossFloorConnections)).toHaveLength(0);
    store.getState().undo();
    expect(store.getState().model).toEqual(model);
  });

  it('queues every edit, undo and redo as changes per document that replay onto the saved state', () => {
    const { store, model, floor, outlet } = setup();
    const { apply, undo, redo } = store.getState();
    const added: Device = { ...outlet, id: crypto.randomUUID(), ports: [], label: 'Ny' };
    apply(addDevice(floor.id, added));
    apply(removeDevice(outlet.id));
    undo();
    redo();

    const pending = store.getState().pending;
    expect(pending[floor.id]).toHaveLength(4);
    expect(pending.project).toHaveLength(3);
    const replayed = replayChanges(model.floors[floor.id]!, pending[floor.id]!);
    expect(replayed.rejected).toEqual([]);
    expect(replayed.doc).toEqual(store.getState().model!.floors[floor.id]);
  });

  it('ignores edits that change nothing and undo with no history', () => {
    const { store, outlet } = setup();
    store.getState().apply(updateDevice(outlet.id, { label: outlet.label }));
    store.getState().undo();
    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().pending).toEqual({});
  });
});
