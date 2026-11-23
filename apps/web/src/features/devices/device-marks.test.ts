import {
  addDevice,
  applyEdit,
  generateProject,
  putSpaceItem,
  removeSpaceItem,
  type Device,
  type Zone,
} from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { FloorFixture } from '@/features/view3d/geometry/test-fixtures';
import { projectWith, pt, wall } from '@/features/floorplan/walls/test-fixtures';
import { deviceMarks, markBounds } from './device-marks';

const outlet = (id: string, wallId: string, offset: number): Device => ({
  id,
  domain: 'power',
  type: 'outlet',
  label: id,
  placement: { kind: 'wall', wallId, offset, height: 0.3, side: 'left' },
  props: {},
  ports: [],
  provenance: { status: 'manual' },
});

const zone: Zone = {
  id: 'zone',
  name: 'Zon',
  polygon: [pt(0, 0), pt(1, 0), pt(1, 1)],
  provenance: { status: 'manual' },
};

describe('deviceMarks', () => {
  it('marks devices at their position, flagged ones at their approximate one, and skips the rest', () => {
    const floor = new FloorFixture();
    const w = floor.wall(pt(0, 0), pt(4, 0), { thickness: 0.2 });
    const on = floor.device(outlet('on', w.id, 1).placement);
    const beyond = floor.device(outlet('beyond', w.id, 9).placement);
    const lost = floor.device(outlet('lost', 'gone', 1).placement);
    const panel = floor.device({ kind: 'floor', at: pt(1, 1) }, { type: 'main_panel' });
    const breaker = floor.device({ kind: 'container', parentId: panel.id, slot: 0 });
    const desk = floor.device(
      { kind: 'floor', at: pt(2, 2), size: { x: 2, y: 1, z: 0.7 } },
      { domain: 'furnishing', type: 'desk' },
    );

    const marks = deviceMarks(floor.data);
    expect(marks[on.id]).toMatchObject({
      at: { x: 1, y: -0.1 },
      approximate: false,
      footprint: null,
    });
    expect(marks[beyond.id]).toMatchObject({ at: { x: 4, y: -0.1 }, approximate: true });
    expect(marks[lost.id]).toBeUndefined();
    expect(marks[breaker.id]).toBeUndefined();
    expect(marks[panel.id]).toMatchObject({ at: { x: 1, y: 1 }, footprint: null });
    expect(marks[desk.id]?.footprint).toHaveLength(4);
    expect(markBounds(marks[desk.id]!)).toEqual({ minX: 1, minY: 1.5, maxX: 3, maxY: 2.5 });
    expect(markBounds(marks[on.id]!)).toEqual({ minX: 1, minY: -0.1, maxX: 1, maxY: -0.1 });
  });

  it('keeps the same record after an edit that leaves devices, walls and rooms alone', () => {
    const { model, floorId } = projectWith([wall(pt(0, 0), pt(4, 0), 0.2, 'w')]);
    const withDevice = applyEdit(model, addDevice(floorId, outlet('d', 'w', 1))).model;
    const before = deviceMarks(withDevice.floors[floorId]!.data);
    const after = applyEdit(withDevice, putSpaceItem(floorId, 'zones', zone)).model;
    expect(deviceMarks(after.floors[floorId]!.data)).toBe(before);
  });

  it('measures again only the devices on a changed wall', () => {
    const { model, floorId } = projectWith([
      wall(pt(0, 0), pt(4, 0), 0.2, 'moved'),
      wall(pt(0, 3), pt(4, 3), 0.2, 'still'),
    ]);
    let next = applyEdit(model, addDevice(floorId, outlet('a', 'moved', 1))).model;
    next = applyEdit(next, addDevice(floorId, outlet('b', 'still', 1))).model;
    const before = deviceMarks(next.floors[floorId]!.data);
    const moved = wall(pt(0, 1), pt(4, 1), 0.2, 'moved');
    next = applyEdit(next, putSpaceItem(floorId, 'walls', moved)).model;
    const after = deviceMarks(next.floors[floorId]!.data);
    expect(after).not.toBe(before);
    expect(after['b']).toBe(before['b']);
    expect(after['a']).not.toBe(before['a']);
    expect(after['a']?.at.y).toBeCloseTo(0.9);

    next = applyEdit(next, removeSpaceItem(floorId, 'walls', 'moved')).model;
    expect(deviceMarks(next.floors[floorId]!.data)['a']).toBeUndefined();
  });

  it('marks every own-marker device of the large synthetic project quickly', () => {
    const floors = Object.values(generateProject('large').floors);
    const start = performance.now();
    const counts = floors.map((f) => Object.keys(deviceMarks(f.data)).length);
    const elapsed = performance.now() - start;
    // Measured at about 10 ms for the ten floors.
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(7000);
    expect(elapsed).toBeLessThan(150);
  });
});
