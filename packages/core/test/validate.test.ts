import { describe, expect, it } from 'vitest';
import { createRegistry, generateProject, validateModel, type Issue } from '../src/index.ts';
import { ModelBuilder } from './builder.ts';
import { testPower } from './plugins.ts';

const codes = (issues: Issue[]) => issues.map((i) => i.code).sort();

describe('validateModel', () => {
  it.each(['small', 'medium', 'large'] as const)(
    'finds no issues in the %s synthetic project',
    (size) => {
      expect(validateModel(generateProject(size), createRegistry([testPower]))).toEqual([]);
    },
  );

  it('checks openings against their wall', () => {
    const b = new ModelBuilder();
    const wall = b.wall(0, { x: 0, y: 0 }, { x: 3, y: 0 });
    const model = b.build();
    const floor = model.floors[b.floors[0]!.id]!;
    const opening = (offset: number, width: number, wallId = wall.id) => {
      const id = b.id();
      floor.data.openings[id] = {
        id,
        wallId,
        kind: 'door',
        offset,
        width,
        height: 2.1,
        provenance: { status: 'manual' },
      };
      return id;
    };
    opening(0.2, 0.9);
    opening(0.8, 0.9);
    opening(2.5, 0.9);
    opening(0, 1, b.id());
    expect(codes(validateModel(model))).toEqual([
      'opening.outside-wall',
      'opening.overlap',
      'opening.wall-missing',
    ]);
  });

  it('checks room and zone polygons', () => {
    const b = new ModelBuilder();
    b.room(0, [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ]);
    b.room(0, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    const model = b.build();
    const zoneId = b.id();
    model.floors[b.floors[0]!.id]!.data.zones[zoneId] = {
      id: zoneId,
      name: 'Gång',
      polygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      provenance: { status: 'manual' },
    };
    expect(codes(validateModel(model))).toEqual([
      'room.polygon-self-intersecting',
      'room.polygon-too-few-points',
      'zone.polygon-zero-area',
    ]);
  });

  it('checks device references, ceiling points and container slots', () => {
    const b = new ModelBuilder();
    const room = b.room(0, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]);
    b.device(0, 'ceiling_light', { kind: 'ceiling', roomId: room.id, at: { x: 5, y: 5 } });
    b.floorDevice(0, 'outlet', [], { roomId: b.id() });
    const panel = b.floorDevice(0, 'main_panel');
    b.device(0, 'breaker', { kind: 'container', parentId: panel.id, slot: 1 });
    b.device(0, 'breaker', { kind: 'container', parentId: panel.id, slot: 1 });
    expect(codes(validateModel(b.build()))).toEqual([
      'device.room-missing',
      'placement.outside-room',
      'placement.slot-taken',
    ]);
  });

  it('checks connection ports and where connections are stored', () => {
    const b = new ModelBuilder(2);
    const a = b.floorDevice(0, 'outlet', ['power-in']);
    const c = b.floorDevice(1, 'outlet', ['power-in']);
    const model = b.build();
    const floor0 = model.floors[b.floors[0]!.id]!;
    const add = (fromPortId: string, toPortId: string) => {
      const id = b.id();
      floor0.data.connections[id] = {
        id,
        domain: 'power',
        kind: 'circuit',
        fromPortId,
        toPortId,
        provenance: { status: 'manual' },
      };
    };
    add(a.port('power-in'), b.id());
    add(a.port('power-in'), c.port('power-in'));
    add(a.port('power-in'), a.port('power-in'));
    expect(codes(validateModel(model))).toEqual([
      'connection.port-missing',
      'connection.self-loop',
      'connection.wrong-document',
    ]);
  });

  it('checks ids are unique and match their keys', () => {
    const b = new ModelBuilder();
    const d = b.floorDevice(0, 'outlet', ['power-in']);
    const model = b.build();
    const devices = model.floors[b.floors[0]!.id]!.data.devices;
    const otherKey = b.id();
    devices[otherKey] = { ...devices[d.id]!, ports: [] };
    expect(codes(validateModel(model))).toEqual(['id.duplicate', 'id.key-mismatch']);
  });

  it('checks devices and connections against registered plugins', () => {
    const b = new ModelBuilder();
    const panel = b.floorDevice(0, 'main_panel', ['power-in']);
    const breaker = b.device(
      0,
      'breaker',
      { kind: 'container', parentId: panel.id, slot: 0 },
      ['power-out'],
      { props: { rating: -1 } },
    );
    const outlet = b.device(
      0,
      'outlet',
      {
        kind: 'ceiling',
        roomId: b.room(0, [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 0, y: 3 },
        ]).id,
        at: { x: 1, y: 1 },
      },
      ['power-in'],
    );
    b.floorDevice(0, 'toaster');
    b.connect('circuit', breaker, 'power-out', outlet, 'power-in');
    b.connect('magic', breaker, 'power-out', outlet, 'power-in');
    b.connect('feeder', outlet, 'power-in', panel, 'power-in');
    const seen: string[] = [];
    const registry = createRegistry([
      { ...testPower, validate: (model) => (seen.push(model.project.id), []) },
    ]);

    expect(codes(validateModel(b.build(), registry))).toEqual([
      'connection.kind-unknown',
      'connection.port-kind-mismatch',
      'device.placement-not-allowed',
      'device.props-invalid',
      'device.type-unknown',
    ]);
    expect(seen).toHaveLength(1);
  });
});
