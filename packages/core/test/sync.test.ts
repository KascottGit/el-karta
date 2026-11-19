import { describe, expect, it } from 'vitest';
import {
  addDevice,
  applyEdit,
  InMemoryRepository,
  removeDevice,
  replayChanges,
  saveWithReplay,
  splitByDocument,
  updateDevice,
  type Change,
  type Edit,
  type FloorRecord,
  type Model,
} from '../src/index.ts';
import { ModelBuilder } from './builder.ts';

function setup() {
  const b = new ModelBuilder();
  const a = b.floorDevice(0, 'outlet', ['power-in']);
  const c = b.floorDevice(0, 'outlet', ['power-in']);
  return { b, model: b.build(), floorId: b.floors[0]!.id, a, c };
}

/** The change one user's edit produces for one floor document. */
function floorChange(
  model: Model,
  floorId: string,
  edit: Edit,
  id: string,
): { model: Model; change: Change } {
  const result = applyEdit(model, edit);
  return {
    model: result.model,
    change: { id, patches: splitByDocument(result.patches).get(floorId) ?? [] },
  };
}

describe('replayChanges', () => {
  it('applies changes to other items on top of a newer document', () => {
    const { model, floorId, a, c } = setup();
    const mine = floorChange(model, floorId, updateDevice(a.id, { label: 'Mitt' }), 'mine');
    const theirs = applyEdit(model, updateDevice(c.id, { label: 'Deras' })).model.floors[floorId]!;

    const result = replayChanges(theirs, [mine.change]);
    expect(result.rejected).toEqual([]);
    expect(result.doc.data.devices[a.id]!.label).toBe('Mitt');
    expect(result.doc.data.devices[c.id]!.label).toBe('Deras');
  });

  it('rejects a change whose device was deleted by someone else, and keeps the rest', () => {
    const { b, model, floorId, a, c } = setup();
    const rename = floorChange(model, floorId, updateDevice(a.id, { label: 'Mitt' }), 'rename');
    const removeA = floorChange(model, floorId, removeDevice(a.id), 'remove-again');
    const outlet = { ...model.floors[floorId]!.data.devices[c.id]!, id: b.id(), ports: [] };
    const add = floorChange(model, floorId, addDevice(floorId, outlet), 'add');
    const theirs = applyEdit(model, removeDevice(a.id)).model.floors[floorId]!;

    const result = replayChanges(theirs, [rename.change, removeA.change, add.change]);
    expect(result.rejected.map((r) => r.change.id)).toEqual(['rename', 'remove-again']);
    expect(result.rejected[0]!.reason).toContain(a.id);
    expect(result.applied.map((c) => c.id)).toEqual(['add']);
    expect(result.doc.data.devices[a.id]).toBeUndefined();
    expect(result.doc.data.devices[outlet.id]).toEqual(outlet);
  });

  it('applies a change all-or-nothing', () => {
    const { model, floorId, a, c } = setup();
    const both = floorChange(
      model,
      floorId,
      (draft, base) => {
        updateDevice(c.id, { label: 'Först' })(draft, base);
        updateDevice(a.id, { label: 'Sedan' })(draft, base);
      },
      'both',
    );
    const theirs = applyEdit(model, removeDevice(a.id)).model.floors[floorId]!;
    const result = replayChanges(theirs, [both.change]);
    expect(result.rejected).toHaveLength(1);
    expect(result.doc).toBe(theirs);
  });
});

describe('InMemoryRepository and saveWithReplay', () => {
  it('round-trips a project through storage', async () => {
    const { model } = setup();
    const repo = new InMemoryRepository();
    await repo.createProject(model);
    expect(await repo.listProjects()).toEqual([
      { id: model.project.id, name: 'Test', kind: 'home' },
    ]);
    expect(await repo.loadProject(model.project.id)).toEqual(model);
    await expect(repo.loadProject('nope')).rejects.toThrow('not found');
  });

  it('saves with optimistic locking and replays queued changes after a conflict', async () => {
    const { model, floorId, a, c } = setup();
    const repo = new InMemoryRepository();
    await repo.createProject(model);
    const base = model.floors[floorId]!;

    const theirs = floorChange(model, floorId, updateDevice(c.id, { label: 'Deras' }), 'theirs');
    const savedTheirs = await saveWithReplay(base, [theirs.change], (r, v) => repo.saveFloor(r, v));
    expect(savedTheirs.record.version).toBe(2);

    const mine = floorChange(model, floorId, updateDevice(a.id, { label: 'Mitt' }), 'mine');
    const attempts: number[] = [];
    const savedMine = await saveWithReplay(base, [mine.change], (record: FloorRecord, expected) => {
      attempts.push(expected);
      return repo.saveFloor(record, expected);
    });
    expect(attempts).toEqual([1, 2]);
    expect(savedMine.rejected).toEqual([]);
    expect(savedMine.record.version).toBe(3);

    const stored = (await repo.loadProject(model.project.id)).floors[floorId]!;
    expect(stored.data.devices[a.id]!.label).toBe('Mitt');
    expect(stored.data.devices[c.id]!.label).toBe('Deras');
  });

  it('returns changes that no longer apply after a conflict', async () => {
    const { model, floorId, a } = setup();
    const repo = new InMemoryRepository();
    await repo.createProject(model);
    const base = model.floors[floorId]!;
    const theirs = floorChange(model, floorId, removeDevice(a.id), 'theirs');
    await saveWithReplay(base, [theirs.change], (r, v) => repo.saveFloor(r, v));

    const mine = floorChange(model, floorId, updateDevice(a.id, { label: 'Mitt' }), 'mine');
    const saved = await saveWithReplay(base, [mine.change], (r, v) => repo.saveFloor(r, v));
    expect(saved.rejected.map((r) => r.change.id)).toEqual(['mine']);
    expect(saved.record.data.devices[a.id]).toBeUndefined();
  });
});
