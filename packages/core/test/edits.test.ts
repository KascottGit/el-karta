import { applyPatches } from 'immer';
import { describe, expect, it } from 'vitest';
import {
  addConnection,
  addDevice,
  applyEdit,
  combine,
  EditError,
  removeConnection,
  removeDevice,
  removeSpaceItem,
  splitByDocument,
  updateDevice,
  validateModel,
  type Connection,
  type Device,
} from '../src/index.ts';
import { ModelBuilder } from './builder.ts';

function setup() {
  const b = new ModelBuilder(2);
  const panel = b.floorDevice(0, 'main_panel', ['power-in']);
  const breaker = b.device(0, 'breaker', { kind: 'container', parentId: panel.id, slot: 0 }, [
    'power-out',
  ]);
  const upstairs = b.floorDevice(1, 'outlet', ['power-in']);
  const local = b.floorDevice(0, 'outlet', ['power-in']);
  const cross = b.connect('circuit', breaker, 'power-out', upstairs, 'power-in');
  const same = b.connect('circuit', breaker, 'power-out', local, 'power-in');
  return {
    b,
    model: b.build(),
    f0: b.floors[0]!.id,
    f1: b.floors[1]!.id,
    panel,
    breaker,
    upstairs,
    local,
    cross,
    same,
  };
}

const newOutlet = (b: ModelBuilder): Device => ({
  id: b.id(),
  domain: 'power',
  type: 'outlet',
  label: 'Nytt uttag',
  placement: { kind: 'floor', at: { x: 0, y: 0 } },
  props: {},
  ports: [{ id: b.id(), domain: 'power', kind: 'power-in' }],
  provenance: { status: 'manual' },
});

describe('edit operations', () => {
  it('adds and updates a device, with patches and inverse patches', () => {
    const { b, model, f1 } = setup();
    const device = newOutlet(b);
    const added = applyEdit(model, addDevice(f1, device));
    expect(added.model.floors[f1]!.data.devices[device.id]).toEqual(device);
    expect(added.patches).toEqual([
      { op: 'add', path: ['floors', f1, 'data', 'devices', device.id], value: device },
    ]);
    expect(applyPatches(added.model, added.inversePatches)).toEqual(model);

    const renamed = applyEdit(added.model, updateDevice(device.id, { label: 'Kök uttag 3' }));
    expect(renamed.patches).toEqual([
      {
        op: 'replace',
        path: ['floors', f1, 'data', 'devices', device.id, 'label'],
        value: 'Kök uttag 3',
      },
    ]);
    expect(model.floors[f1]!.data.devices[device.id]).toBeUndefined();
  });

  it('rejects duplicate ids and unknown targets without changing the model', () => {
    const { b, model, f0, local } = setup();
    expect(() => applyEdit(model, addDevice(f0, { ...newOutlet(b), id: local.id }))).toThrow(
      EditError,
    );
    expect(() =>
      applyEdit(
        model,
        addDevice(f0, {
          ...newOutlet(b),
          ports: [{ id: local.port('power-in'), domain: 'power', kind: 'x' }],
        }),
      ),
    ).toThrow(EditError);
    expect(() => applyEdit(model, addDevice(b.id(), newOutlet(b)))).toThrow(EditError);
    expect(() => applyEdit(model, updateDevice(b.id(), { label: 'x' }))).toThrow(EditError);
    expect(() => applyEdit(model, removeConnection(b.id()))).toThrow(EditError);
  });

  it('stores a connection on its floor, or on the project when it spans floors', () => {
    const { b, model, f0, f1, breaker, upstairs, cross, same } = setup();
    expect(model.floors[f0]!.data.connections[same.id]).toBeDefined();
    expect(model.project.data.crossFloorConnections[cross.id]).toBeDefined();

    const connection: Connection = {
      id: b.id(),
      domain: 'power',
      kind: 'circuit',
      fromPortId: breaker.port('power-out'),
      toPortId: upstairs.port('power-in'),
      provenance: { status: 'manual' },
    };
    const result = applyEdit(model, addConnection(connection));
    expect(result.model.project.data.crossFloorConnections[connection.id]).toEqual(connection);
    expect(Object.keys(result.model.floors[f1]!.data.connections)).toHaveLength(0);
    expect(() =>
      applyEdit(model, addConnection({ ...connection, id: b.id(), toPortId: b.id() })),
    ).toThrow(EditError);
  });

  it('removes a connection from wherever it is stored', () => {
    const { model, f0, cross, same } = setup();
    const result = applyEdit(model, combine(removeConnection(cross.id), removeConnection(same.id)));
    expect(result.model.project.data.crossFloorConnections).toEqual({});
    expect(result.model.floors[f0]!.data.connections).toEqual({});
  });

  it('removes a device with its contained devices and all their connections on every floor', () => {
    const { model, f0, f1, panel, upstairs, local } = setup();
    const result = applyEdit(model, removeDevice(panel.id));
    const floor0 = result.model.floors[f0]!.data;
    expect(Object.keys(floor0.devices)).toEqual([local.id]);
    expect(floor0.connections).toEqual({});
    expect(result.model.project.data.crossFloorConnections).toEqual({});
    expect(result.model.floors[f1]!.data.devices[upstairs.id]).toBeDefined();
    expect(validateModel(result.model)).toEqual([]);
    expect(applyPatches(result.model, result.inversePatches)).toEqual(model);
  });

  it('removes a wall with its openings, leaving devices on it flagged', () => {
    const b = new ModelBuilder();
    const wall = b.wall(0, { x: 0, y: 0 }, { x: 4, y: 0 });
    const outlet = b.device(0, 'outlet', {
      kind: 'wall',
      wallId: wall.id,
      offset: 1,
      height: 0.3,
      side: 'left',
    });
    const model = b.build();
    const floorId = b.floors[0]!.id;
    const openingId = b.id();
    model.floors[floorId]!.data.openings[openingId] = {
      id: openingId,
      wallId: wall.id,
      kind: 'door',
      offset: 2,
      width: 0.9,
      height: 2.1,
      provenance: { status: 'manual' },
    };

    const result = applyEdit(model, removeSpaceItem(floorId, 'walls', wall.id));
    expect(result.model.floors[floorId]!.data.openings).toEqual({});
    expect(validateModel(result.model)).toEqual([
      expect.objectContaining({ code: 'placement.wall-missing', ids: [outlet.id] }),
    ]);
  });

  it('splits patches per stored document with record-relative paths', () => {
    const { model, f0, panel } = setup();
    const { patches } = applyEdit(model, removeDevice(panel.id));
    const split = splitByDocument(patches);
    expect([...split.keys()].sort()).toEqual([f0, 'project'].sort());
    expect(split.get(f0)!.every((p) => p.path[0] === 'data')).toBe(true);
    expect(
      split
        .get('project')!
        .every((p) => p.path[0] === 'data' && p.path[1] === 'crossFloorConnections'),
    ).toBe(true);
    expect(() => splitByDocument([{ op: 'replace', path: ['floors'], value: {} }])).toThrow(
      EditError,
    );
  });
});
