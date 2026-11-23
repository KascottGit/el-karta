import { generateProject } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { floorMeshes } from './floor-meshes';
import { highlightGeometry } from './highlight';

/**
 * The fastest of a few timed runs: the full suite runs many test files in parallel, and one run can
 * lose its CPU for longer than the budget.
 */
function fastest<T>(runs: number, setup: () => T, work: (input: T) => void) {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const input = setup();
    const start = performance.now();
    work(input);
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe('3D mesh performance', () => {
  // Measured at about 80 ms for the ten floors (30,480 wall triangles), validation included.
  it('builds the meshes of every floor of the large synthetic project within 400 ms', () => {
    Object.values(generateProject('small').floors).forEach(floorMeshes);
    let triangles = 0;
    // Fresh floors each run, since meshes are cached per floor data.
    const elapsed = fastest(
      3,
      () => Object.values(generateProject('large').floors),
      (floors) => {
        triangles = floors.map(floorMeshes).reduce((n, m) => n + m.walls.itemOf.length, 0);
      },
    );
    expect(triangles).toBeGreaterThan(20_000);
    expect(elapsed).toBeLessThan(400);
  });

  it('highlights a selection on the busiest floor within a frame', () => {
    const floor = Object.values(generateProject('large', 2).floors)[0]!;
    const meshes = floorMeshes(floor);
    const selection = [
      ...Object.keys(floor.data.walls).slice(0, 20),
      ...Object.keys(floor.data.rooms).slice(0, 5),
    ].map((id) => ({ collection: id in floor.data.walls ? 'walls' : 'rooms', id }) as const);
    const devices = meshes.devices.flatMap((g) => g.ids.slice(0, 10));
    const items = [...selection, ...devices.map((id) => ({ collection: 'devices' as const, id }))];
    let count = 0;
    const elapsed = fastest(
      3,
      () => items,
      (picked) => {
        const h = highlightGeometry(meshes, picked);
        count = h?.items.length ?? 0;
        h?.geometry.dispose();
      },
    );
    expect(elapsed).toBeLessThan(16);
    expect(count).toBe(selection.length + devices.length);
  });
});
