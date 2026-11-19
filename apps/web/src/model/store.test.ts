import {
  addDevice,
  buildGraph,
  generateProject,
  InMemoryRepository,
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

  it('keeps the live graph equal to a rebuilt one through edits, undo and redo', () => {
    const { store, model } = setup();
    const { apply, undo, redo } = store.getState();
    const breaker = Object.values(model.floors)
      .flatMap((f) => Object.values(f.data.devices))
      .find((d) => d.type === 'breaker')!;
    const before = store.getState().graphVersion;
    apply(removeDevice(breaker.id));
    undo();
    redo();
    const { graph, graphVersion, model: current } = store.getState();
    expect(graphVersion).toBe(before + 3);
    const rebuilt = buildGraph(JSON.parse(JSON.stringify(current)) as Model);
    expect(graph!.graph.order).toBe(rebuilt.order);
    expect(graph!.graph.edges().sort()).toEqual(rebuilt.edges().sort());
  });

  it('ignores edits that change nothing and undo with no history', () => {
    const { store, outlet } = setup();
    store.getState().apply(updateDevice(outlet.id, { label: outlet.label }));
    store.getState().undo();
    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().pending).toEqual({});
  });
});

describe('model store saving', () => {
  async function saving() {
    const repository = new InMemoryRepository();
    const model = await repository.createProject(generateProject('small'));
    const [ground, upper] = Object.values(model.floors).sort((a, b) => a.sortOrder - b.sortOrder);
    const outlets = (floorId: string) =>
      Object.values(model.floors[floorId]!.data.devices).filter((d) => d.type === 'outlet');
    const store = createModelStore();
    store.getState().load(model);
    return { repository, model, store, ground: ground!, upper: upper!, outlets };
  }

  it('saves each changed document once and clears its queue', async () => {
    const { repository, model, store, ground, upper, outlets } = await saving();
    const crossFloorOutlet = outlets(upper.id)[0]!;
    store.getState().apply(updateDevice(outlets(ground.id)[0]!.id, { label: 'Sparad' }));
    store.getState().apply(removeDevice(crossFloorOutlet.id));
    await store.getState().save(repository);

    const state = store.getState();
    expect(state.pending).toEqual({ [ground.id]: [], [upper.id]: [], project: [] });
    expect([
      state.model!.floors[ground.id]!.version,
      state.model!.floors[upper.id]!.version,
      state.model!.project.version,
    ]).toEqual([2, 2, 2]);
    expect(await repository.loadProject(model.project.id)).toEqual(state.model);
    expect(state.conflicts).toEqual([]);
  });

  it('merges a newer version saved by someone else and reports changes that no longer apply', async () => {
    const { repository, model, store, ground, outlets } = await saving();
    const [mine, theirs, gone] = outlets(ground.id);
    const other = createModelStore();
    other.getState().load(await repository.loadProject(model.project.id));
    other.getState().apply(updateDevice(theirs!.id, { label: 'Deras' }));
    other.getState().apply(removeDevice(gone!.id));
    await other.getState().save(repository);

    store.getState().apply(updateDevice(mine!.id, { label: 'Min' }));
    store.getState().apply(updateDevice(gone!.id, { label: 'Försvunnen' }));
    await store.getState().save(repository);

    const { model: merged, conflicts, graph } = store.getState();
    const devices = merged!.floors[ground.id]!.data.devices;
    expect([devices[mine!.id]?.label, devices[theirs!.id]?.label, devices[gone!.id]]).toEqual([
      'Min',
      'Deras',
      undefined,
    ]);
    expect(conflicts).toHaveLength(1);
    expect(merged!.floors[ground.id]!.version).toBe(3);
    expect(graph!.graph.hasNode(gone!.id)).toBe(false);
    expect(await repository.loadProject(model.project.id)).toEqual(merged);
  });

  it('keeps edits made while a save is in flight', async () => {
    const { repository, store, ground, outlets } = await saving();
    const [first, second] = outlets(ground.id);
    store.getState().apply(updateDevice(first!.id, { label: 'Först' }));
    const inFlight = store.getState().save(repository);
    store.getState().apply(updateDevice(second!.id, { label: 'Under tiden' }));
    await inFlight;

    const state = store.getState();
    expect(state.pending[ground.id]).toHaveLength(1);
    expect(state.model!.floors[ground.id]!.data.devices[second!.id]!.label).toBe('Under tiden');
    await state.save(repository);
    expect(store.getState().pending[ground.id]).toEqual([]);
    expect(store.getState().model!.floors[ground.id]!.version).toBe(3);
  });
});
