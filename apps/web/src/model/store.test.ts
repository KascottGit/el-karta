import {
  addDevice,
  buildGraph,
  generateProject,
  indexModel,
  InMemoryRepository,
  newFloor,
  removeDevice,
  replayChanges,
  updateDevice,
  type Device,
  type FloorRecord,
  type Model,
  type SaveResult,
} from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { createModelStore, hasUnsavedChanges, UnsavedChangesError, type ModelState } from './store';

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

describe('model store floors', () => {
  async function floors() {
    const repository = new InMemoryRepository();
    const model = await repository.createProject(generateProject('small'));
    const [ground, upper] = Object.values(model.floors).sort((a, b) => a.sortOrder - b.sortOrder);
    const store = createModelStore();
    store.getState().load(model);
    const outlet = (floorId: string) =>
      Object.values(model.floors[floorId]!.data.devices).find((d) => d.type === 'outlet')!;
    return { repository, model, store, ground: ground!, upper: upper!, outlet };
  }

  const expectGraphRebuilt = (state: ModelState) => {
    const rebuilt = buildGraph(JSON.parse(JSON.stringify(state.model)) as Model);
    expect(state.graph!.graph.nodes().sort()).toEqual(rebuilt.nodes().sort());
    expect(state.graph!.graph.edges().sort()).toEqual(rebuilt.edges().sort());
  };

  it('adds a floor while other floors have pending changes, keeping them queued', async () => {
    const { repository, model, store, ground, upper, outlet } = await floors();
    store.getState().apply(updateDevice(outlet(ground.id).id, { label: 'Väntar' }));
    const floor = newFloor(model, {
      id: crypto.randomUUID(),
      buildingId: upper.buildingId,
      name: 'Vind',
    });
    await store.getState().createFloor(repository, floor);

    let state = store.getState();
    expect(state.model!.floors[floor.id]).toEqual(floor);
    expect(state.saved[floor.id]).toEqual(floor);
    expect(state.pending[ground.id]).toHaveLength(1);
    expect(state.past).toHaveLength(1);
    expectGraphRebuilt(state);

    await state.save(repository);
    state = store.getState();
    expect(await repository.loadProject(model.project.id)).toEqual(state.model);
    await expect(store.getState().createFloor(repository, floor)).rejects.toThrow();
  });

  it('removes a floor, its queued changes and cross-floor connections, keeping other floors pending', async () => {
    const { repository, model, store, ground, upper, outlet } = await floors();
    const { deviceFloor, portOwner } = indexModel(model);
    const crossToUpper = Object.values(model.project.data.crossFloorConnections).filter((c) =>
      [c.fromPortId, c.toPortId].some((port) => deviceFloor.get(portOwner.get(port)!) === upper.id),
    );
    expect(crossToUpper.length).toBeGreaterThan(0);
    store.getState().apply(updateDevice(outlet(ground.id).id, { label: 'Kvar' }));
    store.getState().apply(updateDevice(outlet(upper.id).id, { label: 'Borta' }));

    await store.getState().deleteFloor(repository, upper.id);
    let state = store.getState();
    expect(state.model!.floors[upper.id]).toBeUndefined();
    expect(state.pending[upper.id]).toBeUndefined();
    expect(state.saved[upper.id]).toBeUndefined();
    expect(state.pending[ground.id]).toHaveLength(1);
    expect(state.pending.project).toEqual([]);
    expect([state.past, state.future]).toEqual([[], []]);
    for (const c of crossToUpper) {
      expect(state.model!.project.data.crossFloorConnections[c.id]).toBeUndefined();
    }
    expectGraphRebuilt(state);
    const stored = await repository.loadProject(model.project.id);
    expect(stored.floors[upper.id]).toBeUndefined();
    expect(stored.project).toEqual(state.model!.project);

    await state.save(repository);
    state = store.getState();
    expect(await repository.loadProject(model.project.id)).toEqual(state.model);
    expect(state.model!.floors[ground.id]!.data.devices[outlet(ground.id).id]!.label).toBe('Kvar');
  });

  it('waits for a save in flight before deleting a floor', async () => {
    const { repository, model, store, upper, outlet } = await floors();
    store.getState().apply(updateDevice(outlet(upper.id).id, { label: 'Sparas' }));
    const saving = store.getState().save(repository);
    const deleting = store.getState().deleteFloor(repository, upper.id);
    await Promise.all([saving, deleting]);

    const state = store.getState();
    expect(state.saving).toBe(false);
    expect(state.model!.floors[upper.id]).toBeUndefined();
    expect(state.saved[upper.id]).toBeUndefined();
    expect(await repository.loadProject(model.project.id)).toEqual(state.model);
  });

  it('keeps a floor deleted when its save settles late, and stays saving until every save settles', async () => {
    class GatedRepository extends InMemoryRepository {
      readonly failing = new Set<string>();
      readonly gated = new Set<string>();
      release: () => void = () => undefined;
      readonly #gate = new Promise<void>((resolve) => {
        this.release = resolve;
      });

      override async saveFloor(
        record: FloorRecord,
        expected: number,
      ): Promise<SaveResult<FloorRecord>> {
        if (this.failing.has(record.id)) throw new Error('offline');
        if (this.gated.has(record.id)) await this.#gate;
        return super.saveFloor(record, expected);
      }
    }
    const repository = new GatedRepository();
    const model = await repository.createProject(generateProject('small'));
    const [ground, upper] = Object.values(model.floors).sort((a, b) => a.sortOrder - b.sortOrder);
    const store = createModelStore();
    store.getState().load(model);
    const outlet = (floorId: string) =>
      Object.values(model.floors[floorId]!.data.devices).find((d) => d.type === 'outlet')!;
    repository.failing.add(ground!.id);
    repository.gated.add(upper!.id);
    store.getState().apply(updateDevice(outlet(ground!.id).id, { label: 'Misslyckas' }));
    store.getState().apply(updateDevice(outlet(upper!.id).id, { label: 'Försenad' }));

    const saving = store.getState().save(repository);
    const savingResult = saving.then(
      () => 'saved',
      (error: unknown) => (error instanceof Error ? error.message : 'failed'),
    );
    const deleting = store.getState().deleteFloor(repository, upper!.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.getState().saving).toBe(true);
    expect(store.getState().model!.floors[upper!.id]).toBeDefined();

    repository.release();
    await deleting;
    expect(await savingResult).toBe('offline');
    const state = store.getState();
    expect(state.saving).toBe(false);
    expect(state.model!.floors[upper!.id]).toBeUndefined();
    expect(state.saved[upper!.id]).toBeUndefined();
    expect(state.pending[upper!.id]).toBeUndefined();
    expect(state.pending[ground!.id]).toHaveLength(1);
    expect((await repository.loadProject(model.project.id)).floors[upper!.id]).toBeUndefined();
  });

  it('never deletes the last floor, and changes nothing when the repository fails', async () => {
    const { repository, model, store, ground, upper } = await floors();
    const failing = Object.assign(Object.create(repository) as InMemoryRepository, {
      deleteFloor: () => Promise.reject(new Error('offline')),
    });
    await expect(store.getState().deleteFloor(failing, upper.id)).rejects.toThrow('offline');
    expect(store.getState().model).toEqual(model);

    await store.getState().deleteFloor(repository, upper.id);
    await expect(store.getState().deleteFloor(repository, ground.id)).rejects.toThrow(
      'at least one floor',
    );
    expect((await repository.loadProject(model.project.id)).floors[ground.id]).toBeDefined();
    expect(store.getState().saving).toBe(false);
  });
});

describe('model store switching projects', () => {
  const firstOutlet = (model: Model) =>
    Object.values(model.floors)
      .flatMap((f) => Object.values(f.data.devices))
      .find((d) => d.type === 'outlet')!;

  it('refuses to replace a project with unsaved changes unless told to discard them', () => {
    const a = generateProject('small', 1);
    const b = generateProject('small', 2);
    const store = createModelStore();
    store.getState().load(a);
    store.getState().apply(updateDevice(firstOutlet(a).id, { label: 'Osparad' }));

    expect(() => {
      store.getState().load(b);
    }).toThrow(UnsavedChangesError);
    expect(store.getState().model!.project.id).toBe(a.project.id);
    expect(() => {
      store.getState().load(a);
    }).not.toThrow();

    store.getState().load(b, { discardUnsaved: true });
    expect(store.getState().model!.project.id).toBe(b.project.id);
    expect(hasUnsavedChanges(store.getState())).toBe(false);
  });

  it('refuses while a save is in flight, and ignores that save once another project is open', async () => {
    let release = () => {};
    class GatedRepository extends InMemoryRepository {
      override async saveFloor(
        record: FloorRecord,
        expectedVersion: number,
      ): Promise<SaveResult<FloorRecord>> {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return super.saveFloor(record, expectedVersion);
      }
    }
    const repository = new GatedRepository();
    const a = await repository.createProject(generateProject('small', 1));
    const b = generateProject('small', 2);
    const store = createModelStore();
    store.getState().load(a);
    store.getState().apply(updateDevice(firstOutlet(a).id, { label: 'Sparas sent' }));
    const saving = store.getState().save(repository);
    await Promise.resolve();

    expect(store.getState().saving).toBe(true);
    expect(() => {
      store.getState().load(b);
    }).toThrow(UnsavedChangesError);

    store.getState().load(b, { discardUnsaved: true });
    const opened = store.getState().model;
    release();
    await saving;

    expect(store.getState().model).toBe(opened);
    expect(Object.keys(store.getState().saved).sort()).toEqual(
      ['project', ...Object.keys(b.floors)].sort(),
    );
    const stored = await repository.loadProject(a.project.id);
    expect(Object.values(stored.floors).some((f) => f.version === 2)).toBe(true);
  });

  it('forgets everything on clear', () => {
    const { store, outlet } = setup();
    store.getState().apply(updateDevice(outlet.id, { label: 'x' }));
    store.getState().clear();
    const state = store.getState();
    expect([state.model, state.graph, state.past, state.pending, state.saved]).toEqual([
      null,
      null,
      [],
      {},
      {},
    ]);
  });
});
