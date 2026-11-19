import { describe, expect, it } from 'vitest';
import { buildGraph, devicesOf, generateProject, SYNTHETIC_SPECS, trace } from '../src/index.ts';

describe('generateProject', () => {
  it('is deterministic for a seed', () => {
    expect(generateProject('small', 7)).toEqual(generateProject('small', 7));
    expect(generateProject('small', 7).project.id).not.toBe(generateProject('small', 8).project.id);
  });

  it.each(['small', 'medium', 'large'] as const)(
    'builds the %s project at the specified size',
    (size) => {
      const spec = SYNTHETIC_SPECS[size];
      const model = generateProject(size);
      const devices = [...devicesOf(model)].map(([d]) => d);
      expect(Object.keys(model.floors)).toHaveLength(spec.floors);
      expect(Math.abs(devices.length - spec.targetDevices) / spec.targetDevices).toBeLessThan(0.02);
      expect(devices.filter((d) => d.type === 'sub_panel')).toHaveLength(spec.subPanels);
      expect(devices.filter((d) => d.type === 'main_panel')).toHaveLength(1);
    },
  );

  it('wires every load back to the main panel', () => {
    const model = generateProject('medium');
    const graph = buildGraph(model);
    const devices = [...devicesOf(model)].map(([d]) => d);
    const main = devices.find((d) => d.type === 'main_panel')!;
    const reached = trace(graph, main.id, {
      direction: 'downstream',
      domain: 'power',
      kinds: new Set(['circuit', 'feeder', 'contains']),
    });
    expect(reached.steps.size).toBe(devices.length);
    expect(Object.keys(model.project.data.crossFloorConnections).length).toBeGreaterThan(0);
  });
});
