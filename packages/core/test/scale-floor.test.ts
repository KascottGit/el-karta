import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  applyModelPatches,
  EditError,
  generateProject,
  scaleFloor,
  validateModel,
  type Model,
} from '../src/index.ts';
import { ModelBuilder } from './builder.ts';

function setup() {
  const b = new ModelBuilder(2);
  const wall = b.wall(0, { x: 2, y: 2 }, { x: 6, y: 2 }, 0.2);
  const room = b.room(0, [
    { x: 2, y: 2 },
    { x: 6, y: 2 },
    { x: 6, y: 5 },
    { x: 2, y: 5 },
  ]);
  const outlet = b.device(
    0,
    'outlet',
    { kind: 'wall', wallId: wall.id, offset: 1, height: 0.3, side: 'left' },
    ['power-in'],
  );
  const lamp = b.device(0, 'lamp', { kind: 'ceiling', roomId: room.id, at: { x: 4, y: 3 } }, [
    'power-in',
  ]);
  const panel = b.device(
    0,
    'main_panel',
    { kind: 'floor', at: { x: 3, y: 4 }, size: { x: 0.5, y: 0.2, z: 0.8 } },
    ['power-out'],
  );
  const upstairs = b.floorDevice(1, 'outlet', ['power-in']);
  const local = b.connect('circuit', panel, 'power-out', outlet, 'power-in');
  const cross = b.connect('circuit', panel, 'power-out', upstairs, 'power-in');
  const model = b.build();
  const f0 = b.floors[0]!.id;
  const f1 = b.floors[1]!.id;
  const floor = model.floors[f0]!.data;
  floor.openings['o1'] = {
    id: 'o1',
    wallId: wall.id,
    kind: 'door',
    offset: 1,
    width: 0.8,
    height: 2.1,
    sill: 0,
    provenance: { status: 'manual' },
  };
  floor.zones['z1'] = {
    id: 'z1',
    name: 'Zon',
    polygon: [
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 4 },
    ],
    provenance: { status: 'manual' },
  };
  floor.grid = { xLines: [{ label: 'A', pos: 2 }], yLines: [{ label: '1', pos: 4 }] };
  floor.connections[local.id]!.route = [
    { floorId: f0, points: [{ x: 3, y: 4, z: 2 }], certainty: 'traced' },
  ];
  model.project.data.crossFloorConnections[cross.id]!.route = [
    { floorId: f0, points: [{ x: 2, y: 2, z: 2.4 }], certainty: 'traced' },
    { floorId: f1, points: [{ x: 2, y: 2, z: 3 }], certainty: 'traced' },
  ];
  return { model, f0, f1, wall, room, outlet, lamp, panel, local, cross };
}

describe('scaleFloor', () => {
  it('scales everything drawn on the floor about the origin and keeps real heights and sizes', () => {
    const s = setup();
    const origin = { x: 2, y: 2 };
    const { model } = applyEdit(s.model, scaleFloor(s.f0, 1.5, origin));
    const floor = model.floors[s.f0]!.data;

    expect(floor.walls[s.wall.id]).toMatchObject({
      a: { x: 2, y: 2 },
      b: { x: 8, y: 2 },
    });
    expect(floor.walls[s.wall.id]!.thickness).toBeCloseTo(0.3);
    expect(floor.openings['o1']).toMatchObject({ offset: 1.5, height: 2.1, sill: 0 });
    expect(floor.openings['o1']!.width).toBeCloseTo(1.2);
    expect(floor.rooms[s.room.id]!.polygon).toEqual([
      { x: 2, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 6.5 },
      { x: 2, y: 6.5 },
    ]);
    expect(floor.zones['z1']!.polygon[2]).toEqual({ x: 5, y: 5 });
    expect(floor.grid).toEqual({
      xLines: [{ label: 'A', pos: 2 }],
      yLines: [{ label: '1', pos: 5 }],
    });
    expect(floor.devices[s.outlet.id]!.placement).toMatchObject({ offset: 1.5, height: 0.3 });
    expect(floor.devices[s.lamp.id]!.placement).toMatchObject({ at: { x: 5, y: 3.5 } });
    expect(floor.devices[s.panel.id]!.placement).toEqual({
      kind: 'floor',
      at: { x: 3.5, y: 5 },
      size: { x: 0.5, y: 0.2, z: 0.8 },
    });
    expect(floor.connections[s.local.id]!.route![0]!.points).toEqual([{ x: 3.5, y: 5, z: 2 }]);
    const cross = model.project.data.crossFloorConnections[s.cross.id]!.route!;
    expect(cross[0]!.points).toEqual([{ x: 2, y: 2, z: 2.4 }]);
    expect(cross[1]).toEqual(s.model.project.data.crossFloorConnections[s.cross.id]!.route![1]);
    expect(validateModel(model).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('leaves other floors, the background and the scale alone', () => {
    const s = setup();
    s.model.floors[s.f0]!.data.scale = { source: 'user', metresPerPixel: 0.01 };
    s.model.floors[s.f0]!.data.background = {
      attachmentId: 'a',
      offset: { x: 1, y: 1 },
      rotation: 0,
    };
    const { model } = applyEdit(s.model, scaleFloor(s.f0, 2, { x: 0, y: 0 }));
    expect(model.floors[s.f1]).toBe(s.model.floors[s.f1]);
    expect(model.floors[s.f0]!.data.scale).toBe(s.model.floors[s.f0]!.data.scale);
    expect(model.floors[s.f0]!.data.background).toBe(s.model.floors[s.f0]!.data.background);
  });

  it('is undone by its inverse patches', () => {
    const s = setup();
    const { model, inversePatches } = applyEdit(s.model, scaleFloor(s.f0, 0.8, { x: 3, y: 1 }));
    expect(applyModelPatches(model, inversePatches)).toEqual(s.model);
  });

  it('refuses a factor that is not a positive number, and an unknown floor', () => {
    const s = setup();
    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => applyEdit(s.model, scaleFloor(s.f0, factor, { x: 0, y: 0 }))).toThrow(EditError);
    }
    expect(() => applyEdit(s.model, scaleFloor('nope', 2, { x: 0, y: 0 }))).toThrow(EditError);
  });

  it('scales the busiest floor of the large synthetic project quickly', () => {
    const model: Model = generateProject('large');
    const [floorId] = Object.entries(model.floors).sort(
      ([, a], [, b]) => Object.keys(b.data.walls).length - Object.keys(a.data.walls).length,
    )[0]!;
    const start = performance.now();
    applyEdit(model, scaleFloor(floorId, 1.1, { x: 0, y: 0 }));
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
