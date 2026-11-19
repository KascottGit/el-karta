import { performance } from 'node:perf_hooks';
import {
  buildGraph,
  CONTAINS,
  directlyConnected,
  generateProject,
  indexModel,
  parseFloorRecord,
  parseProjectRecord,
  seededRandom,
  trace,
  updateDevice,
  applyEdit,
  type Id,
  type Model,
  type ModelGraph,
  type SyntheticSize,
} from '../src/index.ts';

const POWER = { domain: 'power', kinds: new Set(['circuit', 'feeder', CONTAINS]) };

/** What clicking a device will need: its upstream path, everything on its circuit, and its switch/lights. */
export function selectCircuit(graph: ModelGraph, deviceId: Id) {
  const upstream = trace(graph, deviceId, { ...POWER, direction: 'upstream' });
  const breaker = [...upstream.steps.keys()].find(
    (id) => graph.getNodeAttribute(id, 'type') === 'breaker',
  );
  const circuit =
    breaker === undefined
      ? undefined
      : trace(graph, breaker, { ...POWER, direction: 'downstream' });
  const controls = directlyConnected(graph, deviceId, 'power', 'control');
  return { upstream, circuit, controls };
}

const time = <T>(fn: () => T): [T, number] => {
  const start = performance.now();
  const result = fn();
  return [result, performance.now() - start];
};

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

export interface PerfReport {
  size: SyntheticSize;
  devices: number;
  connections: number;
  storedMegabytes: number;
  openMs: { parse: number; validateSchema: number; graph: number; total: number };
  selectMs: { samples: number; p50: number; p95: number; max: number };
  panelDownstreamMs: number;
  rebuildAfterEditMs: number;
}

export function measure(size: SyntheticSize, samples = 500): PerfReport {
  const generated = generateProject(size);
  const stored = {
    project: JSON.stringify(generated.project),
    floors: Object.values(generated.floors).map((f) => JSON.stringify(f)),
  };
  const storedMegabytes =
    (stored.project.length + stored.floors.reduce((s, f) => s + f.length, 0)) / 1e6;

  const [raw, parseMs] = time(() => ({
    project: JSON.parse(stored.project) as unknown,
    floors: stored.floors.map((f) => JSON.parse(f) as unknown),
  }));
  const [model, validateMs] = time((): Model => {
    const floors = raw.floors.map(parseFloorRecord);
    return {
      project: parseProjectRecord(raw.project),
      floors: Object.fromEntries(floors.map((f) => [f.id, f])),
    };
  });
  const [graph, graphMs] = time(() => buildGraph(model));

  const random = seededRandom(99);
  const loads = graph.filterNodes(
    (_id, attrs) =>
      attrs.type === 'outlet' || attrs.type === 'ceiling_light' || attrs.type === 'switch',
  );
  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    const deviceId = loads[Math.floor(random() * loads.length)]!;
    const [selection, ms] = time(() => selectCircuit(graph, deviceId));
    if (!selection.circuit) throw new Error(`No breaker upstream of ${deviceId}`);
    timings.push(ms);
  }
  timings.sort((a, b) => a - b);

  const main = graph.findNode((_id, attrs) => attrs.type === 'main_panel')!;
  const [everything, panelDownstreamMs] = time(() =>
    trace(graph, main, { ...POWER, direction: 'downstream' }),
  );
  if (everything.steps.size !== graph.order)
    throw new Error('Main panel does not reach every device');

  const [, rebuildAfterEditMs] = time(() => {
    const edited = applyEdit(model, updateDevice(loads[0]!, { label: 'Ändrad' })).model;
    indexModel(edited);
    return buildGraph(edited);
  });

  return {
    size,
    devices: graph.order,
    connections: graph.size,
    storedMegabytes,
    openMs: {
      parse: parseMs,
      validateSchema: validateMs,
      graph: graphMs,
      total: parseMs + validateMs + graphMs,
    },
    selectMs: {
      samples,
      p50: percentile(timings, 0.5),
      p95: percentile(timings, 0.95),
      max: timings[timings.length - 1]!,
    },
    panelDownstreamMs,
    rebuildAfterEditMs,
  };
}

/** From the performance budget in PLAN.md. */
export const BUDGET_MS: Record<SyntheticSize, { open: number; select: number }> = {
  small: { open: 1000, select: 100 },
  medium: { open: 2000, select: 150 },
  large: { open: 4000, select: 250 },
};
