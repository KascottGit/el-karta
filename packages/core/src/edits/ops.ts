import type { Draft } from 'immer';
import type { FloorBackground, FloorScale } from '../geometry/background.ts';
import { indexModel } from '../model.ts';
import type {
  Building,
  Connection,
  Device,
  FloorData,
  FloorRecord,
  Grid,
  Id,
  Model,
  Pt,
  Vec3,
} from '../schemas/index.ts';
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

/** Brings the model in line with a floor row just created through the repository. */
export const addFloor =
  (floor: FloorRecord): Edit =>
  (draft, base) => {
    if (floor.id in base.floors) throw new EditError(`Floor ${floor.id} already exists`);
    if (!(floor.buildingId in base.project.data.buildings))
      throw new EditError(`Unknown building ${floor.buildingId}`);
    draft.floors[floor.id] = floor;
  };

export const updateFloor =
  (floorId: Id, changes: Partial<Pick<FloorRecord, 'name' | 'sortOrder'>>): Edit =>
  (draft) => {
    Object.assign(floorOf(draft, floorId), changes);
  };

/** Replaces the floor's grid lines whole; null or a grid without lines removes the grid. */
export const setGrid =
  (floorId: Id, grid: Grid | null): Edit =>
  (draft) => {
    const { data } = floorOf(draft, floorId);
    if (grid && (grid.xLines.length > 0 || grid.yLines.length > 0)) data.grid = grid;
    else if (data.grid) delete data.grid;
  };

/**
 * Puts a building's floors in the given order, bottom first: `sortOrder` 0, 1, 2 …, and elevations
 * restacked from the lowest current one, each floor starting where the one below ends.
 */
export const reorderFloors =
  (floorIds: readonly Id[]): Edit =>
  (draft) => {
    const floors = floorIds.map((floorId) => floorOf(draft, floorId));
    let elevation = Math.min(...floors.map((floor) => floor.data.elevation));
    floors.forEach((floor, sortOrder) => {
      if (floor.sortOrder !== sortOrder) floor.sortOrder = sortOrder;
      if (floor.data.elevation !== elevation) floor.data.elevation = elevation;
      elevation += floor.data.height;
    });
  };

/**
 * Brings the model in line with a floor row just deleted through the repository: removes the floor,
 * every cross-floor connection to a port on it, and the other connections' route segments on it
 * (a route left with no segments becomes unknown). A project always keeps at least one floor.
 */
export const removeFloor =
  (floorId: Id): Edit =>
  (draft, base) => {
    const floor = base.floors[floorId];
    if (!floor) throw new EditError(`Unknown floor ${floorId}`);
    if (Object.keys(base.floors).length <= 1)
      throw new EditError('A project must keep at least one floor');
    const index = indexModel(base);
    for (const device of Object.values(floor.data.devices)) {
      for (const port of device.ports) {
        for (const connectionId of index.connectionsByPort.get(port.id) ?? []) {
          if (index.connectionDocument.get(connectionId) === 'project')
            delete draft.project.data.crossFloorConnections[connectionId];
        }
      }
    }
    for (const connection of Object.values(draft.project.data.crossFloorConnections)) {
      const route = connection.route?.filter((segment) => segment.floorId !== floorId);
      if (!route || route.length === connection.route?.length) continue;
      if (route.length > 0) connection.route = route;
      else delete connection.route;
    }
    delete draft.floors[floorId];
  };

/**
 * Sets or (with null) removes the floor's background image placement. Walls and everything else
 * stay where they are; only the image moves.
 */
export const setBackground =
  (floorId: Id, background: FloorBackground | null): Edit =>
  (draft) => {
    const { data } = floorOf(draft, floorId);
    if (background) data.background = background;
    else delete data.background;
  };

/** Sets or (with null) removes the floor's plan scale. Like `setBackground`, it moves only the image. */
export const setScale =
  (floorId: Id, scale: FloorScale | null): Edit =>
  (draft) => {
    const { data } = floorOf(draft, floorId);
    if (scale) data.scale = scale;
    else delete data.scale;
  };

export const addBuilding =
  (building: Building): Edit =>
  (draft, base) => {
    if (building.id in base.project.data.buildings)
      throw new EditError(`Building ${building.id} already exists`);
    draft.project.data.buildings[building.id] = building;
  };

export const updateBuilding =
  (buildingId: Id, changes: Partial<Omit<Building, 'id'>>): Edit =>
  (draft) => {
    const building = draft.project.data.buildings[buildingId];
    if (!building) throw new EditError(`Unknown building ${buildingId}`);
    Object.assign(building, changes);
  };

/** Only a building without floors can be removed; its floors are deleted first, through the repository. */
export const removeBuilding =
  (buildingId: Id): Edit =>
  (draft, base) => {
    if (!(buildingId in base.project.data.buildings))
      throw new EditError(`Unknown building ${buildingId}`);
    if (Object.values(base.floors).some((floor) => floor.buildingId === buildingId))
      throw new EditError(`Building ${buildingId} still has floors`);
    delete draft.project.data.buildings[buildingId];
  };

/** Runs several edits as one undoable step. */
export const combine =
  (...edits: Edit[]): Edit =>
  (draft, base) => {
    for (const edit of edits) edit(draft, base);
  };

/**
 * Scales everything drawn on a floor by `factor` about plan point `origin`, as if the drawing it was
 * traced from had been enlarged: wall ends and thickness, opening offsets and widths, room and zone
 * corners, grid lines, device positions (and offsets along walls) and the floor's cable route
 * points, also those of cross-floor connections. Heights, sills and device sizes are real sizes and
 * stay. The background and scale are not touched: callers change those with `setBackground` and
 * `setScale`, usually in the same `combine`.
 */
export const scaleFloor =
  (floorId: Id, factor: number, origin: Pt): Edit =>
  (draft) => {
    if (!(factor > 0) || !Number.isFinite(factor))
      throw new EditError(`Scale factor must be a positive number, got ${factor}`);
    const { data } = floorOf(draft, floorId);
    const at = (p: Pt): Pt => ({
      x: origin.x + (p.x - origin.x) * factor,
      y: origin.y + (p.y - origin.y) * factor,
    });
    const at3 = (p: Vec3): Vec3 => ({ ...at(p), z: p.z });
    for (const wall of Object.values(data.walls)) {
      wall.a = at(wall.a);
      wall.b = at(wall.b);
      wall.thickness *= factor;
    }
    for (const opening of Object.values(data.openings)) {
      opening.offset *= factor;
      opening.width *= factor;
    }
    for (const area of [...Object.values(data.rooms), ...Object.values(data.zones)])
      area.polygon = area.polygon.map(at);
    if (data.grid)
      data.grid = {
        xLines: data.grid.xLines.map((l) => ({
          ...l,
          pos: origin.x + (l.pos - origin.x) * factor,
        })),
        yLines: data.grid.yLines.map((l) => ({
          ...l,
          pos: origin.y + (l.pos - origin.y) * factor,
        })),
      };
    for (const device of Object.values(data.devices)) {
      const p = device.placement;
      if (p.kind === 'wall') p.offset *= factor;
      else if (p.kind === 'floor' || p.kind === 'ceiling') p.at = at(p.at);
    }
    const connections = [
      ...Object.values(data.connections),
      ...Object.values(draft.project.data.crossFloorConnections),
    ];
    for (const connection of connections) {
      for (const segment of connection.route ?? []) {
        if (segment.floorId === floorId) segment.points = segment.points.map(at3);
      }
    }
  };
