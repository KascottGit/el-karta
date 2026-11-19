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

const cache = new WeakMap<Model, ModelIndex>();

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

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/** Lookups derived from a model; memoised per model object, so it is free to call after every edit. */
export function indexModel(model: Model): ModelIndex {
  const cached = cache.get(model);
  if (cached) return cached;
  const deviceFloor = new Map<Id, Id>();
  const portOwner = new Map<Id, Id>();
  const children = new Map<Id, Id[]>();
  const connectionsByPort = new Map<Id, Id[]>();
  const connectionDocument = new Map<Id, DocumentKey>();
  for (const [device, floor] of devicesOf(model)) {
    deviceFloor.set(device.id, floor.id);
    for (const port of device.ports) portOwner.set(port.id, device.id);
    if (device.placement.kind === 'container') push(children, device.placement.parentId, device.id);
  }
  for (const [connection, doc] of connectionsOf(model)) {
    connectionDocument.set(connection.id, doc);
    push(connectionsByPort, connection.fromPortId, connection.id);
    push(connectionsByPort, connection.toPortId, connection.id);
  }
  const index = { deviceFloor, portOwner, children, connectionsByPort, connectionDocument };
  cache.set(model, index);
  return index;
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
  if (doc === undefined) return undefined;
  return doc === 'project'
    ? model.project.data.crossFloorConnections[connectionId]
    : model.floors[doc]?.data.connections[connectionId];
}
