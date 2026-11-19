import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  CONTAINS,
  createRegistry,
  directlyConnected,
  findDevice,
  pathTo,
  trace,
  type Model,
  type TraceOptions,
} from '../src/index.ts';
import { ModelBuilder } from './builder.ts';
import { testNetwork, testPower } from './plugins.ts';

const registry = createRegistry([testPower, testNetwork]);
const power = (direction: TraceOptions['direction']): TraceOptions => ({
  direction,
  domain: 'power',
  kinds: registry.traceKinds('power'),
});

/** Main panel (floor 1) → feeder → sub-panel (floor 2) → breaker → outlets on floors 2 and 3, plus a switch and lights. */
function building() {
  const b = new ModelBuilder(3);
  const main = b.floorDevice(0, 'main_panel', ['power-in']);
  const mainF1 = b.device(0, 'breaker', { kind: 'container', parentId: main.id, slot: 0 }, [
    'power-out',
  ]);
  const mainF2 = b.device(0, 'breaker', { kind: 'container', parentId: main.id, slot: 1 }, [
    'power-out',
  ]);
  const kitchen = b.floorDevice(0, 'outlet', ['power-in']);
  const sub = b.floorDevice(1, 'sub_panel', ['power-in']);
  const subF1 = b.device(1, 'breaker', { kind: 'container', parentId: sub.id, slot: 0 }, [
    'power-out',
  ]);
  const subF2 = b.device(1, 'breaker', { kind: 'container', parentId: sub.id, slot: 1 }, [
    'power-out',
  ]);
  const office = b.floorDevice(1, 'outlet', ['power-in']);
  const attic = b.floorDevice(2, 'outlet', ['power-in']);
  const lightSwitch = b.floorDevice(1, 'switch', ['power-in', 'control-out']);
  const lights = [
    b.floorDevice(1, 'ceiling_light', ['power-in', 'control-in']),
    b.floorDevice(1, 'ceiling_light', ['power-in', 'control-in']),
  ];

  b.connect('feeder', mainF1, 'power-out', sub, 'power-in');
  b.connect('circuit', mainF2, 'power-out', kitchen, 'power-in');
  b.connect('circuit', subF1, 'power-out', office, 'power-in');
  b.connect('circuit', subF1, 'power-out', attic, 'power-in');
  b.connect('circuit', subF2, 'power-out', lightSwitch, 'power-in');
  for (const light of lights) {
    b.connect('circuit', subF2, 'power-out', light, 'power-in');
    b.connect('control', lightSwitch, 'control-out', light, 'control-in');
  }
  return {
    model: b.build(),
    main,
    mainF1,
    mainF2,
    kitchen,
    sub,
    subF1,
    subF2,
    office,
    attic,
    lightSwitch,
    lights,
  };
}

const ids = (result: ReturnType<typeof trace>) => new Set(result.steps.keys());

describe('trace', () => {
  it('follows upstream from an outlet through the sub-panel to the main panel, across floors', () => {
    const t = building();
    const graph = buildGraph(t.model);
    const result = trace(graph, t.attic.id, power('upstream'));
    expect(pathTo(result, t.main.id)).toEqual([
      t.attic.id,
      t.subF1.id,
      t.sub.id,
      t.mainF1.id,
      t.main.id,
    ]);
    expect(ids(result)).toEqual(
      new Set([t.attic.id, t.subF1.id, t.sub.id, t.mainF1.id, t.main.id]),
    );
    expect(
      new Set([t.attic, t.subF1, t.main].map((d) => findDevice(t.model, d.id)?.floor.sortOrder)),
    ).toEqual(new Set([2, 1, 0]));
  });

  it('finds everything on a circuit downstream of its breaker, and everything a panel feeds', () => {
    const t = building();
    const graph = buildGraph(t.model);
    expect(ids(trace(graph, t.subF1.id, power('downstream')))).toEqual(
      new Set([t.subF1.id, t.office.id, t.attic.id]),
    );
    const fromMain = ids(trace(graph, t.main.id, power('downstream')));
    expect(fromMain.size).toBe(12);
    const fromSub = ids(trace(graph, t.sub.id, power('downstream')));
    expect(fromSub.has(t.kitchen.id)).toBe(false);
    expect(fromSub.has(t.lights[1]!.id)).toBe(true);
  });

  it('does not follow control connections when tracing power, but exposes them directly', () => {
    const t = building();
    const graph = buildGraph(t.model);
    const fromSwitch = trace(graph, t.lightSwitch.id, power('downstream'));
    expect(ids(fromSwitch)).toEqual(new Set([t.lightSwitch.id]));
    expect(directlyConnected(graph, t.lightSwitch.id, 'power', 'control').sort()).toEqual(
      t.lights.map((l) => l.id).sort(),
    );
    expect(directlyConnected(graph, t.lights[0]!.id, 'power', 'control')).toEqual([
      t.lightSwitch.id,
    ]);
  });

  it('records the edges it used and the depth of each device', () => {
    const t = building();
    const result = trace(buildGraph(t.model), t.office.id, power('upstream'));
    expect(result.steps.get(t.main.id)?.depth).toBe(4);
    expect(result.edges.has(`${CONTAINS}:${t.subF1.id}`)).toBe(true);
    expect(result.edges.size).toBe(4);
  });

  it('ignores other domains and returns nothing for an unknown start', () => {
    const t = building();
    const graph = buildGraph(t.model);
    expect(trace(graph, t.attic.id, { ...power('upstream'), domain: 'network' }).steps.size).toBe(
      1,
    );
    expect(trace(graph, 'missing', power('upstream')).steps.size).toBe(0);
  });

  it('respects port links so a trace through a patch panel follows only the linked port', () => {
    const b = new ModelBuilder();
    const net = { domain: 'network' };
    const sw = b.floorDevice(0, 'switch', ['lan', 'lan'], net);
    const patch = b.floorDevice(0, 'patch_panel', ['front', 'front', 'back', 'back'], net);
    const outlets = [
      b.floorDevice(0, 'wall_outlet', ['lan'], net),
      b.floorDevice(0, 'wall_outlet', ['lan'], net),
    ];
    const model: Model = b.build();
    const patchPorts = model.floors[b.floors[0]!.id]!.data.devices[patch.id]!.ports;
    const swPorts = model.floors[b.floors[0]!.id]!.data.devices[sw.id]!.ports;
    const link = (from: string, to: string) => {
      const id = b.id();
      model.floors[b.floors[0]!.id]!.data.connections[id] = {
        id,
        domain: 'network',
        kind: 'ethernet',
        fromPortId: from,
        toPortId: to,
        provenance: { status: 'manual' },
      };
    };
    link(swPorts[0]!.id, patchPorts[0]!.id);
    link(swPorts[1]!.id, patchPorts[1]!.id);
    link(patchPorts[2]!.id, outlets[0]!.port('lan'));
    link(patchPorts[3]!.id, outlets[1]!.port('lan'));
    const graph = buildGraph(model);
    const result = trace(graph, outlets[1]!.id, {
      direction: 'upstream',
      domain: 'network',
      kinds: registry.traceKinds('network'),
      linkedPorts: (deviceId, portId) => {
        const found = findDevice(model, deviceId);
        return found ? registry.linkedPorts(found.device, portId) : null;
      },
    });
    expect(result.edges.size).toBe(2);
    expect(pathTo(result, sw.id)).toEqual([outlets[1]!.id, patch.id, sw.id]);
  });
});
