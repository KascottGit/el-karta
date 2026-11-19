import type { Draft } from 'immer';
import { indexModel } from '../model.ts';
import type { Connection, Device, FloorData, FloorRecord, Id, Model } from '../schemas/index.ts';
import { EditError, type Edit } from './apply.ts';

type SpaceCollection = 'walls' | 'openings' | 'rooms' | 'zones';
type SpaceItem<C extends SpaceCollection> = FloorData[C][Id];

const floorOf = (draft: Draft<Model>, floorId: Id): Draft<FloorRecord> => {
  const floor = draft.floors[floorId];
  if (!floor) throw new EditError(`Unknown floor ${floorId}`);
  return floor;
};

/** Adds or replaces a wall, opening, room or zone. Array fields are replaced whole so patches stay id-addressed. */
export const putSpaceItem =
  <C extends SpaceCollection>(floorId: Id, collection: C, item: SpaceItem<C>): Edit =>
  (draft) => {
    (floorOf(draft, floorId).data[collection] as Record<Id, SpaceItem<C>>)[item.id] = item;
  };

/** Removing a wall also removes its openings; devices placed on it stay and are flagged by validation. */
export const removeSpaceItem =
  (floorId: Id, collection: SpaceCollection, id: Id): Edit =>
  (draft) => {
    const { data } = floorOf(draft, floorId);
    if (!(id in data[collection])) throw new EditError(`Unknown ${collection} item ${id}`);
    delete data[collection][id];
    if (collection === 'walls') {
      for (const opening of Object.values(data.openings)) {
        if (opening.wallId === id) delete data.openings[opening.id];
      }
    }
  };

export const addDevice =
  (floorId: Id, device: Device): Edit =>
  (draft, base) => {
    const index = indexModel(base);
    if (index.deviceFloor.has(device.id)) throw new EditError(`Device ${device.id} already exists`);
    for (const port of device.ports) {
      if (index.portOwner.has(port.id)) throw new EditError(`Port ${port.id} already exists`);
    }
    floorOf(draft, floorId).data.devices[device.id] = device;
  };

export const updateDevice =
  (deviceId: Id, changes: Partial<Omit<Device, 'id'>>): Edit =>
  (draft, base) => {
    const floorId = indexModel(base).deviceFloor.get(deviceId);
    const device =
      floorId === undefined ? undefined : draft.floors[floorId]?.data.devices[deviceId];
    if (!device) throw new EditError(`Unknown device ${deviceId}`);
    Object.assign(device, changes);
  };

/** Removes the device, everything in its slots, and every connection to their ports, on any floor. */
export const removeDevice =
  (deviceId: Id): Edit =>
  (draft, base) => {
    const index = indexModel(base);
    if (!index.deviceFloor.has(deviceId)) throw new EditError(`Unknown device ${deviceId}`);
    const doomed: Id[] = [];
    const collect = (id: Id) => {
      doomed.push(id);
      for (const child of index.children.get(id) ?? []) collect(child);
    };
    collect(deviceId);
    const connectionIds = new Set<Id>();
    for (const id of doomed) {
      const floorId = index.deviceFloor.get(id);
      const device = floorId === undefined ? undefined : base.floors[floorId]?.data.devices[id];
      if (!device || floorId === undefined) continue;
      for (const port of device.ports) {
        for (const connectionId of index.connectionsByPort.get(port.id) ?? [])
          connectionIds.add(connectionId);
      }
      delete floorOf(draft, floorId).data.devices[id];
    }
    for (const connectionId of connectionIds) deleteConnection(draft, base, connectionId);
  };

/** Stored on the floor when both ends are on it; otherwise in the project's cross-floor connections. */
export const addConnection =
  (connection: Connection): Edit =>
  (draft, base) => {
    const index = indexModel(base);
    if (index.connectionDocument.has(connection.id))
      throw new EditError(`Connection ${connection.id} already exists`);
    const floors = [connection.fromPortId, connection.toPortId].map((portId) => {
      const owner = index.portOwner.get(portId);
      const floorId = owner === undefined ? undefined : index.deviceFloor.get(owner);
      if (floorId === undefined) throw new EditError(`Unknown port ${portId}`);
      return floorId;
    });
    const [fromFloor, toFloor] = floors as [Id, Id];
    if (fromFloor === toFloor)
      floorOf(draft, fromFloor).data.connections[connection.id] = connection;
    else draft.project.data.crossFloorConnections[connection.id] = connection;
  };

export const removeConnection =
  (connectionId: Id): Edit =>
  (draft, base) => {
    if (!indexModel(base).connectionDocument.has(connectionId))
      throw new EditError(`Unknown connection ${connectionId}`);
    deleteConnection(draft, base, connectionId);
  };

function deleteConnection(draft: Draft<Model>, base: Model, connectionId: Id) {
  const doc = indexModel(base).connectionDocument.get(connectionId);
  if (doc === 'project') delete draft.project.data.crossFloorConnections[connectionId];
  else if (doc !== undefined) delete floorOf(draft, doc).data.connections[connectionId];
}

/** Runs several edits as one undoable step. */
export const combine =
  (...edits: Edit[]): Edit =>
  (draft, base) => {
    for (const edit of edits) edit(draft, base);
  };
