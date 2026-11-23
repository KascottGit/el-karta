import { generateProject } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { floorMeshes } from './floor-meshes';
import { highlightGeometry } from './highlight';

describe('3D mesh performance', () => {
  // Measured at about 80 ms for the ten floors (30,480 wall triangles), validation included.
  it('builds the meshes of every floor of the large synthetic project within 400 ms', () => {
    Object.values(generateProject('small').floors).forEach(floorMeshes);
    const floors = Object.values(generateProject('large').floors);
    const start = performance.now();
    const built = floors.map(floorMeshes);
    const elapsed = performance.now() - start;
    expect(built.reduce((n, m) => n + m.walls.itemOf.length, 0)).toBeGreaterThan(20_000);
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
    const start = performance.now();
    const h = highlightGeometry(meshes, [
      ...selection,
      ...devices.map((id) => ({ collection: 'devices' as const, id })),
    ]);
    expect(performance.now() - start).toBeLessThan(16);
    expect(h?.items.length).toBe(selection.length + devices.length);
  });
});
