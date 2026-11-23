import { generateProject } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { buildFloorGeometry } from './floor';

const floorsOf = (size: 'small' | 'large') =>
  Object.values(generateProject(size).floors).map((f) => f.data);

describe('3D geometry performance', () => {
  // Measured at about 20 ms for the ten floors (2,540 wall pieces, 480 slabs, 7,261 devices).
  it('builds every floor of the large synthetic project within 200 ms', () => {
    floorsOf('small').forEach(buildFloorGeometry);
    const floors = floorsOf('large');
    const start = performance.now();
    const built = floors.map(buildFloorGeometry);
    const elapsed = performance.now() - start;
    expect(built.reduce((n, g) => n + g.walls.length, 0)).toBeGreaterThan(2000);
    expect(built.reduce((n, g) => n + g.devices.length, 0)).toBeGreaterThan(7000);
    expect(elapsed).toBeLessThan(200);
  });
});
