import { describe, expect, it } from 'vitest';
import {
  addBuilding,
  addFloor,
  applyEdit,
  buildGraph,
  buildingsInOrder,
  EditError,
  floorsInOrder,
  generateProject,
  indexModel,
  InMemoryRepository,
  LiveGraph,
  newFloor,
  NotFoundError,
  removeBuilding,
  removeFloor,
  reorderFloors,
  splitByDocument,
  updateBuilding,
  updateFloor,
  validateModel,
  type Model,
} from '../src/index.ts';
import { ModelBuilder } from './builder.ts';

function setup() {
  const b = new ModelBuilder(3);
  const panel = b.floorDevice(0, 'main_panel', ['power-out']);
  const sub = b.floorDevice(1, 'sub_panel', ['power-in', 'power-out']);
  const outlet = b.floorDevice(2, 'outlet', ['power-in']);
  const local = b.floorDevice(1, 'outlet', ['power-in']);
  const feeder = b.connect('feeder', panel, 'power-out', sub, 'power-in');
  const circuit = b.connect('circuit', sub, 'power-out', outlet, 'power-in');
  const same = b.connect('circuit', sub, 'power-out', local, 'power-in');
  const model = b.build();
  const [f0, f1, f2] = b.floors.map((floor) => floor.id) as [string, string, string];
  return { b, model, f0, f1, f2, feeder, circuit, same, buildingId: b.floors[0]!.buildingId };
}

describe('floor helpers', () => {
  it('stacks a new floor on top of its building at the default height for the project kind', () => {
    const { b, model, buildingId, f2 } = setup();
    const top = model.floors[f2]!;
    const floor = newFloor(model, { id: b.id(), buildingId, name: 'Vind' });
    expect(floor).toMatchObject({
      projectId: model.project.id,
      buildingId,
      name: 'Vind',
      sortOrder: top.sortOrder + 1,
      version: 1,
      data: { elevation: top.data.elevation + top.data.height, height: 2.4 },
    });
    const office = { ...model, project: { ...model.project, kind: 'warehouse' as const } };
    expect(newFloor(office, { id: b.id(), buildingId, name: 'x' }).data.height).toBe(8);
  });

  it('starts a building without floors at ground level', () => {
    const { b, model } = setup();
    const withBuilding = applyEdit(model, addBuilding({ id: b.id(), name: 'Garage' })).model;
    const garage = buildingsInOrder(withBuilding).find((x) => x.name === 'Garage')!;
    const floor = newFloor(withBuilding, { id: b.id(), buildingId: garage.id, name: 'Plan 1' });
    expect(floor).toMatchObject({ sortOrder: 0, data: { elevation: 0 } });
  });

  it('lists floors bottom-up per building and buildings by name', () => {
    const { b, model, f0, f1, f2, buildingId } = setup();
    const reordered = applyEdit(model, reorderFloors([f2, f0, f1])).model;
    expect(floorsInOrder(reordered, buildingId).map((f) => f.id)).toEqual([f2, f0, f1]);
    const withBuildings = applyEdit(reordered, addBuilding({ id: b.id(), name: 'Annex' })).model;
    expect(buildingsInOrder(withBuildings).map((x) => x.name)).toEqual(['Annex', 'Hus']);
    expect(floorsInOrder(withBuildings, 'nope')).toEqual([]);
  });
});

describe('floor and building edits', () => {
  it('adds a floor that belongs to a known building, once', () => {
    const { b, model, buildingId } = setup();
    const floor = newFloor(model, { id: b.id(), buildingId, name: 'Plan 4' });
    const result = applyEdit(model, addFloor(floor));
    expect(result.model.floors[floor.id]).toEqual(floor);
    expect(validateModel(result.model)).toEqual([]);
    expect(() => applyEdit(result.model, addFloor(floor))).toThrow(EditError);
    expect(() => applyEdit(model, addFloor({ ...floor, buildingId: b.id() }))).toThrow(EditError);
  });

  it('renames and reorders floors with patches on the floor documents only', () => {
    const { model, f0, f1, f2 } = setup();
    const renamed = applyEdit(model, updateFloor(f1, { name: 'Entréplan' }));
    expect(renamed.model.floors[f1]!.name).toBe('Entréplan');
    expect(renamed.patches).toEqual([
      { op: 'replace', path: ['floors', f1, 'name'], value: 'Entréplan' },
    ]);

    const reordered = applyEdit(model, reorderFloors([f1, f0, f2]));
    expect(Object.fromEntries(splitByDocument(reordered.patches))).toEqual({
      [f1]: [{ op: 'replace', path: ['sortOrder'], value: 0 }],
      [f0]: [{ op: 'replace', path: ['sortOrder'], value: 1 }],
    });
    expect(() => applyEdit(model, updateFloor('nope', { name: 'x' }))).toThrow(EditError);
  });

  it('removes a floor with the cross-floor connections to it, keeping the rest', () => {
    const { model, f0, f1, f2, feeder, circuit, same } = setup();
    const result = applyEdit(model, removeFloor(f2));
    expect(Object.keys(result.model.floors).sort()).toEqual([f0, f1].sort());
    expect(Object.keys(result.model.project.data.crossFloorConnections)).toEqual([feeder.id]);
    expect(result.model.floors[f1]!.data.connections[same.id]).toBeDefined();
    expect(validateModel(result.model)).toEqual([]);
    expect([...splitByDocument(result.patches).keys()].sort()).toEqual([f2, 'project'].sort());
    expect(indexModel(result.model).connectionDocument.has(circuit.id)).toBe(false);
  });

  it('keeps a live graph equal to a rebuilt one when a floor is added or removed', () => {
    const { b, model, buildingId, f1 } = setup();
    const live = new LiveGraph(model);
    const check = (next: Model) => {
      const rebuilt = buildGraph(JSON.parse(JSON.stringify(next)) as Model);
      expect(live.graph.nodes().sort()).toEqual(rebuilt.nodes().sort());
      expect(live.graph.edges().sort()).toEqual(rebuilt.edges().sort());
    };
    const removed = applyEdit(model, removeFloor(f1));
    live.update(removed.model, removed.patches);
    check(removed.model);
    const added = applyEdit(
      removed.model,
      addFloor(newFloor(removed.model, { id: b.id(), buildingId, name: 'Ny' })),
    );
    live.update(added.model, added.patches);
    check(added.model);
  });

  it('never removes the last floor or an unknown one', () => {
    const b = new ModelBuilder(1);
    const model = b.build();
    expect(() => applyEdit(model, removeFloor(b.floors[0]!.id))).toThrow(EditError);
    expect(() => applyEdit(setup().model, removeFloor('nope'))).toThrow(EditError);
  });

  it('adds, renames and removes buildings in the project document', () => {
    const { b, model, buildingId } = setup();
    const id = b.id();
    const added = applyEdit(model, addBuilding({ id, name: 'Garage' }));
    expect([...splitByDocument(added.patches).keys()]).toEqual(['project']);
    expect(() => applyEdit(added.model, addBuilding({ id, name: 'Igen' }))).toThrow(EditError);

    const renamed = applyEdit(added.model, updateBuilding(id, { name: 'Carport' }));
    expect(renamed.model.project.data.buildings[id]!.name).toBe('Carport');
    expect(() => applyEdit(model, updateBuilding(b.id(), { name: 'x' }))).toThrow(EditError);

    const removed = applyEdit(renamed.model, removeBuilding(id));
    expect(removed.model.project.data.buildings[id]).toBeUndefined();
    expect(() => applyEdit(model, removeBuilding(buildingId))).toThrow('still has floors');
  });
});

describe('InMemoryRepository floors', () => {
  it('creates and deletes floor rows that load with the project', async () => {
    const repo = new InMemoryRepository();
    const model = await repo.createProject(generateProject('small'));
    const [ground] = Object.values(model.floors);
    const floor = newFloor(model, {
      id: crypto.randomUUID(),
      buildingId: ground!.buildingId,
      name: 'Vind',
    });

    expect(await repo.createFloor(floor)).toEqual(floor);
    await expect(repo.createFloor(floor)).rejects.toThrow('already exists');
    expect((await repo.loadProject(model.project.id)).floors[floor.id]).toEqual(floor);

    await repo.deleteFloor(model.project.id, floor.id);
    expect(await repo.loadProject(model.project.id)).toEqual(model);
    await expect(repo.deleteFloor(model.project.id, floor.id)).rejects.toThrow(NotFoundError);
    await expect(repo.createFloor({ ...floor, projectId: 'nope' })).rejects.toThrow(NotFoundError);
  });
});
