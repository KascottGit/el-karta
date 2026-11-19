import { emptyFloorData, type FloorData, type Pt } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { areaSnapTargets, snapAreaPoint } from './area-snap';

const pt = (x: number, y: number): Pt => ({ x, y });

function floorData(): FloorData {
  const data = emptyFloorData(2.4);
  data.walls.w = {
    id: 'w',
    a: pt(0, 0),
    b: pt(4, 0),
    thickness: 0.2,
    provenance: { status: 'manual' },
  };
  data.rooms.r = {
    id: 'r',
    name: 'Kök',
    type: 'kitchen',
    polygon: [pt(0, 0), pt(4, 0), pt(4, 3), pt(0, 3)],
    provenance: { status: 'manual' },
  };
  data.zones.z = {
    id: 'z',
    name: 'Zon',
    polygon: [pt(10, 10), pt(12, 10), pt(12, 12)],
    provenance: { status: 'manual' },
  };
  return data;
}

describe('area snapping', () => {
  const targets = areaSnapTargets(floorData());

  it('snaps to a wall end or polygon corner before a side', () => {
    expect(snapAreaPoint(pt(3.95, 0.04), targets, 0.1)).toEqual({ point: pt(4, 0), snapped: true });
    expect(snapAreaPoint(pt(11.93, 11.95), targets, 0.1)).toEqual({
      point: pt(12, 12),
      snapped: true,
    });
  });

  it('snaps onto a wall centreline or polygon side when no corner is near', () => {
    expect(snapAreaPoint(pt(2, 0.05), targets, 0.1)).toEqual({ point: pt(2, 0), snapped: true });
    expect(snapAreaPoint(pt(4.06, 1.5), targets, 0.1)).toEqual({
      point: pt(4, 1.5),
      snapped: true,
    });
  });

  it('leaves the point alone beyond the tolerance', () => {
    expect(snapAreaPoint(pt(2, 1), targets, 0.1)).toEqual({ point: pt(2, 1), snapped: false });
  });

  it('skips the polygon being edited and adds extra corners', () => {
    expect(snapAreaPoint(pt(4.06, 1.5), targets, 0.1, { ignore: 'r' }).snapped).toBe(false);
    expect(snapAreaPoint(pt(7.02, 7), targets, 0.1, { extra: [pt(7, 7)] }).point).toEqual(pt(7, 7));
  });

  it('builds the targets once per floor data', () => {
    const data = floorData();
    expect(areaSnapTargets(data)).toBe(areaSnapTargets(data));
  });
});
