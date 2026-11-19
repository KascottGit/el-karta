import { pointInPolygon, polygonProblem, resolvePlacement, wallLength } from '../geometry/index.ts';
import { EPSILON } from '../geometry/vec.ts';
import { connectionsOf, devicesOf, indexModel } from '../model.ts';
import type { PluginRegistry } from '../plugin/registry.ts';
import type { FloorRecord, Id, Model } from '../schemas/index.ts';
import type { Issue } from './issue.ts';

export function validateModel(model: Model, registry?: PluginRegistry): Issue[] {
  const issues = [...checkIds(model)];
  for (const floor of Object.values(model.floors)) {
    issues.push(...checkSpace(floor), ...checkDevices(floor));
  }
  issues.push(...checkConnections(model));
  if (registry) issues.push(...checkAgainstPlugins(model, registry));
  return issues;
}

export function checkIds(model: Model): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<Id>();
  const claim = (id: Id, floorId?: Id) => {
    if (seen.has(id)) {
      issues.push({
        code: 'id.duplicate',
        severity: 'error',
        ids: [id],
        ...(floorId && { floorId }),
      });
    }
    seen.add(id);
  };
  const checkKeys = (collection: Record<Id, { id: Id }>, floorId?: Id) => {
    for (const [key, item] of Object.entries(collection)) {
      if (key !== item.id) {
        issues.push({
          code: 'id.key-mismatch',
          severity: 'error',
          ids: [item.id],
          params: { key },
          ...(floorId && { floorId }),
        });
      }
      claim(item.id, floorId);
    }
  };
  checkKeys(model.project.data.buildings);
  checkKeys(model.project.data.crossFloorConnections);
  checkKeys(model.floors);
  for (const floor of Object.values(model.floors)) {
    const { data } = floor;
    for (const collection of [
      data.walls,
      data.openings,
      data.rooms,
      data.zones,
      data.devices,
      data.connections,
    ]) {
      checkKeys(collection, floor.id);
    }
    for (const device of Object.values(data.devices)) {
      for (const port of device.ports) claim(port.id, floor.id);
    }
    if (!(floor.buildingId in model.project.data.buildings)) {
      issues.push({
        code: 'floor.building-missing',
        severity: 'error',
        ids: [floor.id],
        floorId: floor.id,
      });
    }
  }
  return issues;
}

export function checkSpace(floor: FloorRecord): Issue[] {
  const issues: Issue[] = [];
  const floorId = floor.id;
  const { walls, openings, rooms, zones } = floor.data;
  for (const wall of Object.values(walls)) {
    if (wallLength(wall) < EPSILON)
      issues.push({ code: 'wall.zero-length', severity: 'error', ids: [wall.id], floorId });
  }
  const openingsByWall = new Map<Id, { start: number; end: number; id: Id }[]>();
  for (const opening of Object.values(openings)) {
    const wall = walls[opening.wallId];
    if (!wall) {
      issues.push({
        code: 'opening.wall-missing',
        severity: 'error',
        ids: [opening.id, opening.wallId],
        floorId,
      });
      continue;
    }
    const length = wallLength(wall);
    if (opening.offset + opening.width > length + EPSILON) {
      issues.push({
        code: 'opening.outside-wall',
        severity: 'error',
        ids: [opening.id, wall.id],
        floorId,
        params: { end: opening.offset + opening.width, wallLength: length },
      });
    }
    const spans = openingsByWall.get(wall.id) ?? [];
    for (const other of spans) {
      if (
        opening.offset < other.end - EPSILON &&
        other.start < opening.offset + opening.width - EPSILON
      ) {
        issues.push({
          code: 'opening.overlap',
          severity: 'warning',
          ids: [opening.id, other.id],
          floorId,
        });
      }
    }
    spans.push({ start: opening.offset, end: opening.offset + opening.width, id: opening.id });
    openingsByWall.set(wall.id, spans);
  }
  for (const [kind, areas] of [
    ['room', rooms],
    ['zone', zones],
  ] as const) {
    for (const area of Object.values(areas)) {
      const problem = polygonProblem(area.polygon);
      if (problem)
        issues.push({
          code: `${kind}.polygon-${problem}`,
          severity: 'error',
          ids: [area.id],
          floorId,
        });
    }
  }
  return issues;
}

export function checkDevices(floor: FloorRecord): Issue[] {
  const issues: Issue[] = [];
  const floorId = floor.id;
  const { devices, rooms, zones } = floor.data;
  const slots = new Map<string, Id>();
  for (const device of Object.values(devices)) {
    if (device.roomId && !rooms[device.roomId]) {
      issues.push({
        code: 'device.room-missing',
        severity: 'error',
        ids: [device.id, device.roomId],
        floorId,
      });
    }
    if (device.zoneId && !zones[device.zoneId]) {
      issues.push({
        code: 'device.zone-missing',
        severity: 'error',
        ids: [device.id, device.zoneId],
        floorId,
      });
    }
    const resolved = resolvePlacement(floor.data, device);
    if (!resolved.ok) {
      const { code, ...params } = resolved.problem;
      issues.push({
        code: `placement.${code}`,
        severity: code === 'offset-beyond-wall' ? 'warning' : 'error',
        ids: [device.id],
        floorId,
        params,
      });
    }
    const { placement } = device;
    if (placement.kind === 'ceiling') {
      const room = rooms[placement.roomId];
      if (room && !pointInPolygon(placement.at, room.polygon)) {
        issues.push({
          code: 'placement.outside-room',
          severity: 'warning',
          ids: [device.id, room.id],
          floorId,
        });
      }
    }
    if (placement.kind === 'container') {
      const key = `${placement.parentId}#${placement.slot}`;
      const other = slots.get(key);
      if (other) {
        issues.push({
          code: 'placement.slot-taken',
          severity: 'error',
          ids: [device.id, other],
          floorId,
          params: { slot: placement.slot },
        });
      }
      slots.set(key, device.id);
    }
  }
  return issues;
}

export function checkConnections(model: Model): Issue[] {
  const issues: Issue[] = [];
  const index = indexModel(model);
  for (const [connection, doc] of connectionsOf(model)) {
    const floorId = doc === 'project' ? undefined : doc;
    const at = floorId ? { floorId } : {};
    if (connection.fromPortId === connection.toPortId) {
      issues.push({ code: 'connection.self-loop', severity: 'error', ids: [connection.id], ...at });
    }
    for (const portId of [connection.fromPortId, connection.toPortId]) {
      const owner = index.portOwner.get(portId);
      if (!owner) {
        issues.push({
          code: 'connection.port-missing',
          severity: 'error',
          ids: [connection.id, portId],
          ...at,
        });
      } else if (floorId && index.deviceFloor.get(owner) !== floorId) {
        issues.push({
          code: 'connection.wrong-document',
          severity: 'error',
          ids: [connection.id, owner],
          ...at,
        });
      }
    }
  }
  return issues;
}

export function checkAgainstPlugins(model: Model, registry: PluginRegistry): Issue[] {
  const issues: Issue[] = [];
  const index = indexModel(model);
  const portKind = new Map<Id, string>();
  for (const [device, floor] of devicesOf(model)) {
    const floorId = floor.id;
    for (const port of device.ports) portKind.set(port.id, port.kind);
    const def = registry.deviceType(device.domain, device.type);
    if (!def) {
      issues.push({
        code: 'device.type-unknown',
        severity: 'warning',
        ids: [device.id],
        floorId,
        params: { domain: device.domain, type: device.type },
      });
      continue;
    }
    if (!def.placements.includes(device.placement.kind)) {
      issues.push({
        code: 'device.placement-not-allowed',
        severity: 'error',
        ids: [device.id],
        floorId,
        params: { placement: device.placement.kind },
      });
    }
    const props = def.props.safeParse(device.props);
    if (!props.success) {
      issues.push({
        code: 'device.props-invalid',
        severity: 'error',
        ids: [device.id],
        floorId,
        params: { detail: props.error.message },
      });
    }
  }
  for (const [connection, doc] of connectionsOf(model)) {
    const at = doc === 'project' ? {} : { floorId: doc };
    const def = registry.connectionKind(connection.domain, connection.kind);
    if (!def) {
      issues.push({
        code: 'connection.kind-unknown',
        severity: 'warning',
        ids: [connection.id],
        ...at,
        params: { domain: connection.domain, kind: connection.kind },
      });
      continue;
    }
    const from = portKind.get(connection.fromPortId);
    const to = portKind.get(connection.toPortId);
    if ((from && !def.fromPortKinds.includes(from)) || (to && !def.toPortKinds.includes(to))) {
      const ids = [
        connection.id,
        index.portOwner.get(connection.fromPortId),
        index.portOwner.get(connection.toPortId),
      ];
      issues.push({
        code: 'connection.port-kind-mismatch',
        severity: 'error',
        ids: ids.filter((id) => id !== undefined),
        ...at,
      });
    }
  }
  for (const plugin of registry.plugins) issues.push(...(plugin.validate?.(model) ?? []));
  return issues;
}
