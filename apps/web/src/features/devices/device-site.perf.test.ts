import { generateProject, type FloorData } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { fastest } from '@/features/view3d/fastest';
import { movedDevice, newDeviceSite } from './device-site';

const busiest = (): FloorData =>
  Object.values(generateProject('large').floors)
    .map((f) => f.data)
    .sort((a, b) => Object.keys(b.walls).length - Object.keys(a.walls).length)[0]!;

describe('device site performance', () => {
  // Measured at about 0.12 ms per pointer move on the busiest large floor (110 walls, 48 rooms).
  it('finds where a device goes and where a dragged one moves to within 1 ms per pointer move', () => {
    const floor = busiest();
    const device = Object.values(floor.devices).find((d) => d.placement.kind === 'wall')!;
    const points = Array.from({ length: 200 }, (_, i) => ({ x: (i % 20) * 1.7, y: i * 0.13 }));
    let placed = 0;
    const elapsed = fastest(
      3,
      () => points,
      (list) => {
        for (const p of list) {
          if (newDeviceSite(floor, { placements: ['wall'], defaultHeight: 1 }, p, 0.3)) placed++;
          if (newDeviceSite(floor, { placements: ['ceiling'] }, p, 0.3)) placed++;
          movedDevice(floor, device, p, 0.3);
        }
      },
    );
    expect(Object.keys(floor.walls).length).toBeGreaterThan(100);
    expect(placed).toBeGreaterThan(0);
    expect(elapsed / points.length).toBeLessThan(1);
  });
});
