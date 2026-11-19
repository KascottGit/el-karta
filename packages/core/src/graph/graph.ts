import { MultiDirectedGraph } from 'graphology';
import type { Patch } from 'immer';
import {
  connectionIn,
  deltaFromPatches,
  devicesOf,
  connectionsOf,
  indexModel,
  type DocumentKey,
} from '../model.ts';
import type { Connection, Device, Id, Model } from '../schemas/index.ts';

/** Edge kind linking a container (panel, rack) to the devices in its slots. */
export const CONTAINS = 'contains';

export interface DeviceNode {
  floorId: Id;
  domain: string;
  type: string;
}

export interface LinkEdge {
  kind: string;
  domain: string;
  /** Null for containment edges, which join whole devices. */
  fromPortId: Id | null;
  toPortId: Id | null;
}

export type ModelGraph = MultiDirectedGraph<DeviceNode, LinkEdge>;

const containsKey = (childId: Id) => `${CONTAINS}:${childId}`;

function addContains(graph: ModelGraph, child: Device) {
  const { placement } = child;
  if (
    placement.kind !== 'container' ||
    !graph.hasNode(placement.parentId) ||
    !graph.hasNode(child.id)
  ) {
    return;
  }
  if (graph.hasEdge(containsKey(child.id))) return;
  graph.addDirectedEdgeWithKey(containsKey(child.id), placement.parentId, child.id, {
    kind: CONTAINS,
    domain: graph.getNodeAttribute(placement.parentId, 'domain'),
    fromPortId: null,
    toPortId: null,
  });
}

function addConnection(graph: ModelGraph, model: Model, connection: Connection) {
  const { portOwner } = indexModel(model);
  const from = portOwner.get(connection.fromPortId);
  const to = portOwner.get(connection.toPortId);
  if (from === undefined || to === undefined || from === to) return;
  if (!graph.hasNode(from) || !graph.hasNode(to) || graph.hasEdge(connection.id)) return;
  graph.addDirectedEdgeWithKey(connection.id, from, to, {
    kind: connection.kind,
    domain: connection.domain,
    fromPortId: connection.fromPortId,
    toPortId: connection.toPortId,
  });
}

function fill(graph: ModelGraph, model: Model) {
  for (const [device, floor] of devicesOf(model)) {
    graph.addNode(device.id, { floorId: floor.id, domain: device.domain, type: device.type });
  }
  for (const [device] of devicesOf(model)) addContains(graph, device);
  for (const [connection] of connectionsOf(model)) addConnection(graph, model, connection);
}

/**
 * One directed graph over every floor: nodes are devices, edges are connections (source → load)
 * plus containment (container → child). Connections to missing ports are skipped; validators report them.
 */
export function buildGraph(model: Model): ModelGraph {
  const graph: ModelGraph = new MultiDirectedGraph({ allowSelfLoops: false });
  fill(graph, model);
  return graph;
}

/**
 * A graph kept in step with a changing model. `update` touches only the devices and connections
 * the patches changed, so an edit costs time proportional to the edit, not the building.
 */
export class LiveGraph {
  readonly graph: ModelGraph;
  #model: Model;

  constructor(model: Model) {
    this.#model = model;
    this.graph = buildGraph(model);
  }

  get model(): Model {
    return this.#model;
  }

  /** `patches` must be the ones that turned the current model into `next`. */
  update(next: Model, patches: readonly Patch[]): void {
    const delta = deltaFromPatches(patches);
    this.#model = next;
    if (delta.structural) {
      this.graph.clear();
      fill(this.graph, next);
      return;
    }
    const index = indexModel(next);
    for (const [deviceId, floorIds] of delta.devices) {
      if (this.graph.hasNode(deviceId)) this.graph.dropNode(deviceId);
      const floorId = [...floorIds].find((id) => next.floors[id]?.data.devices[deviceId]);
      const device =
        floorId === undefined ? undefined : next.floors[floorId]?.data.devices[deviceId];
      if (!device || floorId === undefined) continue;
      this.graph.addNode(deviceId, { floorId, domain: device.domain, type: device.type });
      addContains(this.graph, device);
      for (const childId of index.children.get(deviceId) ?? []) {
        const child = this.#device(childId);
        if (child) addContains(this.graph, child);
      }
      for (const port of device.ports) {
        for (const connectionId of index.connectionsByPort.get(port.id) ?? []) {
          const doc = index.connectionDocument.get(connectionId);
          const connection = doc === undefined ? undefined : connectionIn(next, doc, connectionId);
          if (connection) addConnection(this.graph, next, connection);
        }
      }
    }
    for (const [connectionId, docs] of delta.connections) {
      if (this.graph.hasEdge(connectionId)) this.graph.dropEdge(connectionId);
      const connection = [...docs]
        .map((doc: DocumentKey) => connectionIn(next, doc, connectionId))
        .find(Boolean);
      if (connection) addConnection(this.graph, next, connection);
    }
  }

  #device(deviceId: Id): Device | undefined {
    const floorId = indexModel(this.#model).deviceFloor.get(deviceId);
    return floorId === undefined ? undefined : this.#model.floors[floorId]?.data.devices[deviceId];
  }
}
