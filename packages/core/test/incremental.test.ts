import type { Patch } from 'immer';
import { describe, expect, it } from 'vitest';
import {
  addConnection,
  addDevice,
  applyEdit,
  applyModelPatches,
  buildGraph,
  devicesOf,
  generateProject,
  indexModel,
  LiveGraph,
  removeConnection,
  removeDevice,
  seededRandom,
  seededUuid,
  updateDevice,
  connectionsOf,
  type Edit,
  type Model,
  type ModelGraph,
  type ModelIndex,
} from '../src/index.ts';

const byKey = (a: readonly unknown[], b: readonly unknown[]) =>
  (a[0] as string).localeCompare(b[0] as string);

const sortedEntries = <V>(map: ReadonlyMap<string, V>, normalise: (v: V) => unknown = (v) => v) =>
  [...map.entries()].map(([k, v]) => [k, normalise(v)]).sort(byKey);

const snapshotIndex = (index: ModelIndex) => ({
  deviceFloor: sortedEntries(index.deviceFloor),
  portOwner: sortedEntries(index.portOwner),
  children: sortedEntries(index.children, (ids) => [...ids].sort()),
  connectionsByPort: sortedEntries(index.connectionsByPort, (ids) => [...ids].sort()),
  connectionDocument: sortedEntries(index.connectionDocument),
});

const snapshotGraph = (graph: ModelGraph) => ({
  nodes: graph.mapNodes((key, attrs) => [key, attrs]).sort(byKey),
  edges: graph.mapEdges((key, attrs, source, target) => [key, source, target, attrs]).sort(byKey),
});

const fresh = (model: Model) => JSON.parse(JSON.stringify(model)) as Model;

/** Random edits of every kind the edit operations support, including cascades across floors. */
function randomEdit(model: Model, random: () => number, id: () => string): Edit {
  const devices = [...devicesOf(model)];
  const connections = [...connectionsOf(model)];
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!;
  const roll = random();
  if (roll < 0.25) {
    const containers = devices.filter(([d]) => d.type.endsWith('_panel'));
    const [device] = pick(roll < 0.1 ? containers : devices);
    return updateDevice(device.id, { label: `Ändrad ${id().slice(0, 4)}` });
  }
  if (roll < 0.4) {
    const containers = devices.filter(([d]) => d.type.endsWith('_panel'));
    const [device] = pick(roll < 0.3 && containers.length > 0 ? containers : devices);
    return removeDevice(device.id);
  }
  if (roll < 0.55 && connections.length > 0) return removeConnection(pick(connections)[0].id);
  if (roll < 0.7) {
    const [breaker] = pick(devices.filter(([d]) => d.type === 'breaker'));
    const [load] = pick(devices.filter(([d]) => d.ports.some((p) => p.kind === 'power-in')));
    return addConnection({
      id: id(),
      domain: 'power',
      kind: 'circuit',
      fromPortId: breaker.ports[0]!.id,
      toPortId: load.ports.find((p) => p.kind === 'power-in')!.id,
      provenance: { status: 'manual' },
    });
  }
  if (roll < 0.85) {
    const panels = devices.filter(([d]) => d.type === 'main_panel' || d.type === 'sub_panel');
    const [panel, floor] = pick(panels);
    const portId = id();
    return addDevice(floor.id, {
      id: id(),
      domain: 'power',
      type: 'breaker',
      label: 'Ny',
      placement: { kind: 'container', parentId: panel.id, slot: 100 + Math.floor(random() * 1000) },
      props: {},
      ports: [{ id: portId, domain: 'power', kind: 'power-out' }],
      provenance: { status: 'manual' },
    });
  }
  const breakers = devices.filter(([d]) => d.type === 'breaker');
  const panels = devices.filter(([d]) => d.type === 'sub_panel');
  const [breaker] = pick(breakers);
  const [panel] = pick(panels);
  return updateDevice(breaker.id, {
    placement: { kind: 'container', parentId: panel.id, slot: 500 },
  });
}

describe('incremental index and graph', () => {
  it('match a full rebuild after random edits, undos and redos', () => {
    const random = seededRandom(5);
    const id = seededUuid(seededRandom(6));
    let model = generateProject('medium');
    indexModel(model);
    const live = new LiveGraph(model);
    const history: Patch[][] = [];

    for (let step = 0; step < 150; step++) {
      let next: Model;
      let patches: Patch[];
      if (step % 7 === 6 && history.length > 0) {
        patches = history.pop()!;
        next = applyModelPatches(model, patches);
      } else {
        const result = applyEdit(model, randomEdit(model, random, id));
        patches = result.patches;
        next = result.model;
        history.push(result.inversePatches);
      }
      live.update(next, patches);
      model = next;

      if (step % 10 === 0 || step === 149) {
        expect(snapshotIndex(indexModel(model))).toEqual(snapshotIndex(indexModel(fresh(model))));
        expect(snapshotGraph(live.graph)).toEqual(snapshotGraph(buildGraph(fresh(model))));
      }
    }
  });

  it('rebuilds everything when a patch replaces a whole floor', () => {
    const model = generateProject('small');
    const live = new LiveGraph(model);
    const floor = Object.values(model.floors)[0]!;
    const patches = [{ op: 'remove' as const, path: ['floors', floor.id] }];
    const next = applyModelPatches(model, patches);
    live.update(next, patches);
    expect(snapshotGraph(live.graph)).toEqual(snapshotGraph(buildGraph(fresh(next))));
    expect(snapshotIndex(indexModel(next))).toEqual(snapshotIndex(indexModel(fresh(next))));
  });
});
