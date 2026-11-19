import { MultiDirectedGraph } from 'graphology';
import { connectionsOf, devicesOf, indexModel } from '../model.ts';
import type { Id, Model } from '../schemas/index.ts';

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

/**
 * One directed graph over every floor: nodes are devices, edges are connections (source → load)
 * plus containment (container → child). Connections to missing ports are skipped; validators report them.
 */
export function buildGraph(model: Model): ModelGraph {
  const graph: ModelGraph = new MultiDirectedGraph({ allowSelfLoops: false });
  const { portOwner } = indexModel(model);
  for (const [device, floor] of devicesOf(model)) {
    graph.addNode(device.id, { floorId: floor.id, domain: device.domain, type: device.type });
  }
  for (const [device] of devicesOf(model)) {
    const { placement } = device;
    if (placement.kind === 'container' && graph.hasNode(placement.parentId)) {
      graph.addDirectedEdgeWithKey(`${CONTAINS}:${device.id}`, placement.parentId, device.id, {
        kind: CONTAINS,
        domain: graph.getNodeAttribute(placement.parentId, 'domain'),
        fromPortId: null,
        toPortId: null,
      });
    }
  }
  for (const [connection] of connectionsOf(model)) {
    const from = portOwner.get(connection.fromPortId);
    const to = portOwner.get(connection.toPortId);
    if (from === undefined || to === undefined || from === to) continue;
    graph.addDirectedEdgeWithKey(connection.id, from, to, {
      kind: connection.kind,
      domain: connection.domain,
      fromPortId: connection.fromPortId,
      toPortId: connection.toPortId,
    });
  }
  return graph;
}
