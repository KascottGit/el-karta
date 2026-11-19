import type { Patch } from 'immer';
import type { Connection, Device, FloorRecord, Id, Model } from './schemas/index.ts';

/** A stored document: a floor id, or `'project'` for the project document. */
export type DocumentKey = string;

export interface ModelIndex {
  deviceFloor: ReadonlyMap<Id, Id>;
  portOwner: ReadonlyMap<Id, Id>;
  children: ReadonlyMap<Id, readonly Id[]>;
  connectionsByPort: ReadonlyMap<Id, readonly Id[]>;
  connectionDocument: ReadonlyMap<Id, DocumentKey>;
}

interface MutableIndex {
  deviceFloor: Map<Id, Id>;
  portOwner: Map<Id, Id>;
  children: Map<Id, Id[]>;
  connectionsByPort: Map<Id, Id[]>;
  connectionDocument: Map<Id, DocumentKey>;
}

/** Which devices and connections a set of patches touched, with the documents they were touched in. */
export interface ModelDelta {
  devices: Map<Id, Set<Id>>;
  connections: Map<Id, Set<DocumentKey>>;
  /** A patch replaced a whole floor or collection, so derived structures must be rebuilt. */
  structural: boolean;
}

const cache = new WeakMap<Model, MutableIndex>();

export function* connectionsOf(model: Model): Generator<[Connection, DocumentKey]> {
  for (const connection of Object.values(model.project.data.crossFloorConnections)) {
    yield [connection, 'project'];
  }
  for (const floor of Object.values(model.floors)) {
    for (const connection of Object.values(floor.data.connections)) yield [connection, floor.id];
  }
}

export function* devicesOf(model: Model): Generator<[Device, FloorRecord]> {
  for (const floor of Object.values(model.floors)) {
    for (const device of Object.values(floor.data.devices)) yield [device, floor];
  }
}

export function connectionIn(model: Model, doc: DocumentKey, id: Id): Connection | undefined {
  return doc === 'project'
    ? model.project.data.crossFloorConnections[id]
    : model.floors[doc]?.data.connections[id];
}

const addTo = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

const removeFrom = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key)?.filter((v) => v !== value);
  if (list?.length) map.set(key, list);
  else map.delete(key);
};

function indexDevice(index: MutableIndex, device: Device, floorId: Id) {
  index.deviceFloor.set(device.id, floorId);
  for (const port of device.ports) index.portOwner.set(port.id, device.id);
  if (device.placement.kind === 'container')
    addTo(index.children, device.placement.parentId, device.id);
}

function unindexDevice(index: MutableIndex, device: Device) {
  index.deviceFloor.delete(device.id);
  for (const port of device.ports) {
    if (index.portOwner.get(port.id) === device.id) index.portOwner.delete(port.id);
  }
  if (device.placement.kind === 'container')
    removeFrom(index.children, device.placement.parentId, device.id);
}

function indexConnection(index: MutableIndex, connection: Connection, doc: DocumentKey) {
  index.connectionDocument.set(connection.id, doc);
  addTo(index.connectionsByPort, connection.fromPortId, connection.id);
  addTo(index.connectionsByPort, connection.toPortId, connection.id);
}

function unindexConnection(index: MutableIndex, connection: Connection) {
  index.connectionDocument.delete(connection.id);
  removeFrom(index.connectionsByPort, connection.fromPortId, connection.id);
  removeFrom(index.connectionsByPort, connection.toPortId, connection.id);
}

/** Lookups derived from a model; memoised per model object and carried forward by `advanceIndex`. */
export function indexModel(model: Model): ModelIndex {
  const cached = cache.get(model);
  if (cached) return cached;
  const index: MutableIndex = {
    deviceFloor: new Map(),
    portOwner: new Map(),
    children: new Map(),
    connectionsByPort: new Map(),
    connectionDocument: new Map(),
  };
  for (const [device, floor] of devicesOf(model)) indexDevice(index, device, floor.id);
  for (const [connection, doc] of connectionsOf(model)) indexConnection(index, connection, doc);
  cache.set(model, index);
  return index;
}

export function deltaFromPatches(patches: readonly Patch[]): ModelDelta {
  const delta: ModelDelta = { devices: new Map(), connections: new Map(), structural: false };
  const touch = (map: Map<Id, Set<string>>, id: string | number | undefined, doc: string) => {
    if (id === undefined) delta.structural = true;
    else map.set(String(id), (map.get(String(id)) ?? new Set()).add(doc));
  };
  for (const { path } of patches) {
    const [root, a, b, c, d] = path;
    if (root === 'project') {
      if (a === undefined || (a === 'data' && b === undefined)) delta.structural = true;
      else if (a === 'data' && b === 'crossFloorConnections')
        touch(delta.connections, c, 'project');
    } else if (root === 'floors') {
      if (a === undefined || b === undefined || (b === 'data' && c === undefined))
        delta.structural = true;
      else if (b === 'data' && c === 'devices') touch(delta.devices, d, String(a));
      else if (b === 'data' && c === 'connections') touch(delta.connections, d, String(a));
    } else {
      delta.structural = true;
    }
  }
  return delta;
}

/**
 * Moves `prev`'s cached index to `next`, updating only what the delta touched. `prev` loses its cache
 * entry (its index is rebuilt if asked for again), so an edit costs time proportional to its size, not the building's.
 */
export function advanceIndex(prev: Model, next: Model, delta: ModelDelta): void {
  const index = cache.get(prev);
  if (!index || delta.structural || prev === next) return;
  cache.delete(prev);
  for (const [deviceId, floorIds] of delta.devices) {
    const prevFloor = index.deviceFloor.get(deviceId);
    const before =
      prevFloor === undefined ? undefined : prev.floors[prevFloor]?.data.devices[deviceId];
    if (before) unindexDevice(index, before);
    for (const floorId of floorIds) {
      const after = next.floors[floorId]?.data.devices[deviceId];
      if (after) indexDevice(index, after, floorId);
    }
  }
  for (const [connectionId, docs] of delta.connections) {
    const prevDoc = index.connectionDocument.get(connectionId);
    const before = prevDoc === undefined ? undefined : connectionIn(prev, prevDoc, connectionId);
    if (before) unindexConnection(index, before);
    for (const doc of docs) {
      const after = connectionIn(next, doc, connectionId);
      if (after) indexConnection(index, after, doc);
    }
  }
  cache.set(next, index);
}

export function findDevice(
  model: Model,
  deviceId: Id,
): { device: Device; floor: FloorRecord } | undefined {
  const floorId = indexModel(model).deviceFloor.get(deviceId);
  const floor = floorId === undefined ? undefined : model.floors[floorId];
  const device = floor?.data.devices[deviceId];
  return floor && device ? { device, floor } : undefined;
}

export function findConnection(model: Model, connectionId: Id): Connection | undefined {
  const doc = indexModel(model).connectionDocument.get(connectionId);
  return doc === undefined ? undefined : connectionIn(model, doc, connectionId);
}
