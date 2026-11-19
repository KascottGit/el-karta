import type { Id } from '../schemas/index.ts';
import type { LinkEdge, ModelGraph } from './graph.ts';

export type TraceDirection = 'upstream' | 'downstream';

export interface TraceOptions {
  direction: TraceDirection;
  domain: string;
  kinds: ReadonlySet<string>;
  /** Ports reachable inside a device from the port a trace entered through; null when all ports are joined. */
  linkedPorts?: (deviceId: Id, entryPortId: Id) => ReadonlySet<Id> | null;
}

export interface TraceStep {
  deviceId: Id;
  depth: number;
  /** The device this one was reached from, and the edge used; null for the start. */
  previous: Id | null;
  edge: string | null;
}

export interface TraceResult {
  start: Id;
  /** Breadth-first order, so each device appears at its shortest distance from the start. */
  steps: Map<Id, TraceStep>;
  edges: Set<string>;
}

/**
 * Breadth-first walk over the model graph following only `kinds` within `domain`.
 * graphology-traversal cannot filter edges or track the entry port, so the loop lives here and uses graphology for adjacency.
 */
export function trace(graph: ModelGraph, start: Id, options: TraceOptions): TraceResult {
  const steps = new Map<Id, TraceStep>([
    [start, { deviceId: start, depth: 0, previous: null, edge: null }],
  ]);
  const edges = new Set<string>();
  if (!graph.hasNode(start)) return { start, steps: new Map(), edges };
  const downstream = options.direction === 'downstream';
  const visited = new Set<string>([start]);
  let frontier: { deviceId: Id; reachable: ReadonlySet<Id> | null }[] = [
    { deviceId: start, reachable: null },
  ];
  let depth = 0;

  while (frontier.length > 0) {
    depth++;
    const next: typeof frontier = [];
    for (const { deviceId, reachable } of frontier) {
      const visit = (edge: string, attrs: LinkEdge, source: Id, target: Id) => {
        if (attrs.domain !== options.domain || !options.kinds.has(attrs.kind)) return;
        const exitPortId = downstream ? attrs.fromPortId : attrs.toPortId;
        if (reachable && exitPortId !== null && !reachable.has(exitPortId)) return;
        edges.add(edge);
        const neighbour = downstream ? target : source;
        const entryPortId = downstream ? attrs.toPortId : attrs.fromPortId;
        const neighbourReachable =
          entryPortId === null ? null : (options.linkedPorts?.(neighbour, entryPortId) ?? null);
        const key = neighbourReachable ? `${neighbour}#${entryPortId ?? ''}` : neighbour;
        if (visited.has(key)) return;
        visited.add(key);
        if (!steps.has(neighbour))
          steps.set(neighbour, { deviceId: neighbour, depth, previous: deviceId, edge });
        next.push({ deviceId: neighbour, reachable: neighbourReachable });
      };
      if (downstream) graph.forEachOutEdge(deviceId, visit);
      else graph.forEachInEdge(deviceId, visit);
    }
    frontier = next;
  }
  return { start, steps, edges };
}

/** Device ids from the trace start to `deviceId`, inclusive; empty if it was not reached. */
export function pathTo(result: TraceResult, deviceId: Id): Id[] {
  const path: Id[] = [];
  let step = result.steps.get(deviceId);
  while (step) {
    path.push(step.deviceId);
    step = step.previous === null ? undefined : result.steps.get(step.previous);
  }
  return path.reverse();
}

/** Devices joined to `deviceId` by a direct edge of `kind` in either direction, e.g. switch ↔ lights. */
export function directlyConnected(
  graph: ModelGraph,
  deviceId: Id,
  domain: string,
  kind: string,
): Id[] {
  if (!graph.hasNode(deviceId)) return [];
  const result = new Set<Id>();
  graph.forEachEdge(deviceId, (_edge, attrs, source, target) => {
    if (attrs.domain === domain && attrs.kind === kind)
      result.add(source === deviceId ? target : source);
  });
  return [...result];
}
