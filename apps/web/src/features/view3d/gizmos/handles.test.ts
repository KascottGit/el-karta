import { describe, expect, it } from 'vitest';
import { FloorFixture, pt } from '../geometry/test-fixtures';
import { gizmoHandles, gizmoTarget, handleNear, type GizmoHandle } from './handles';

const byName = (handles: GizmoHandle[]) => Object.fromEntries(handles.map((h) => [h.name, h]));

describe('gizmoTarget', () => {
  it('is the one selected wall or opening', () => {
    expect(gizmoTarget([{ collection: 'walls', id: 'w' }])).toEqual({
      collection: 'walls',
      id: 'w',
    });
    expect(gizmoTarget([{ collection: 'openings', id: 'o' }])).toEqual({
      collection: 'openings',
      id: 'o',
    });
  });

  it('is null for nothing, several items or other kinds', () => {
    expect(gizmoTarget([])).toBeNull();
    expect(
      gizmoTarget([
        { collection: 'walls', id: 'a' },
        { collection: 'walls', id: 'b' },
      ]),
    ).toBeNull();
    expect(gizmoTarget([{ collection: 'devices', id: 'd' }])).toBeNull();
  });
});

describe('gizmoHandles', () => {
  it('puts a wall’s move arrows on its faces, corners at its top ends and its height at mid-top', () => {
    const f = new FloorFixture(2.5);
    const w = f.wall(pt(0, 0), pt(4, 0), { thickness: 0.2, height: 3 });
    const h = byName(gizmoHandles(f.data, { collection: 'walls', id: w.id }));
    // Left of +x in y-down plan coordinates is -y.
    expect(h['move-left']?.at).toEqual({ x: 2, y: -0.1, z: 1.5 });
    expect(h['move-right']?.at).toEqual({ x: 2, y: 0.1, z: 1.5 });
    expect(h['move-left']?.constraint).toEqual({ kind: 'axis', dir: { x: 0, y: -1, z: 0 } });
    expect(h['corner-a']).toMatchObject({
      at: { x: 0, y: 0, z: 3 },
      constraint: { kind: 'level' },
    });
    expect(h['corner-b']?.at).toEqual({ x: 4, y: 0, z: 3 });
    expect(h['height']).toMatchObject({
      at: { x: 2, y: 0, z: 3 },
      constraint: { kind: 'axis', dir: { x: 0, y: 0, z: 1 } },
    });
  });

  it('uses the floor height for a wall without its own', () => {
    const f = new FloorFixture(2.4);
    const w = f.wall(pt(0, 0), pt(0, 2));
    expect(byName(gizmoHandles(f.data, { collection: 'walls', id: w.id }))['height']?.at.z).toBe(
      2.4,
    );
  });

  it('puts an opening’s handles on its cut-out, with a sill handle only for a window', () => {
    const f = new FloorFixture(2.5);
    const w = f.wall(pt(0, 0), pt(4, 0));
    const win = f.opening(w.id, 'window', 1, 1.2, 1.2, 0.9);
    const h = byName(gizmoHandles(f.data, { collection: 'openings', id: win.id }));
    expect(Object.keys(h).sort()).toEqual(['end', 'sill', 'slide', 'start', 'top']);
    expect(h['slide']).toMatchObject({
      at: { x: 1.6, y: 0, z: 1.5 },
      constraint: { kind: 'axis', dir: { x: 1, y: 0, z: 0 } },
      shape: 'arrow',
    });
    expect(h['start']?.at).toEqual({ x: 1, y: 0, z: 1.5 });
    expect(h['end']?.at.x).toBeCloseTo(2.2);
    expect(h['top']?.at.z).toBeCloseTo(2.1);
    expect(h['sill']?.at.z).toBeCloseTo(0.9);

    const door = f.opening(w.id, 'door', 2.5, 0.9, 2.1);
    expect(
      gizmoHandles(f.data, { collection: 'openings', id: door.id }).map((x) => x.name),
    ).toEqual(['slide', 'start', 'end', 'top']);
  });

  it('clamps an opening’s handles to its wall like its cut-out', () => {
    const f = new FloorFixture(2.5);
    const w = f.wall(pt(0, 0), pt(2, 0));
    const door = f.opening(w.id, 'door', 1.5, 0.9, 3);
    const h = byName(gizmoHandles(f.data, { collection: 'openings', id: door.id }));
    expect(h['end']?.at.x).toBeCloseTo(2);
    expect(h['top']?.at.z).toBeCloseTo(2.5);
  });

  it('has no handles for a missing item or an opening on a missing wall', () => {
    const f = new FloorFixture();
    const o = f.opening('nowhere', 'door', 0, 1, 2);
    expect(gizmoHandles(f.data, { collection: 'walls', id: 'x' })).toEqual([]);
    expect(gizmoHandles(f.data, { collection: 'openings', id: o.id })).toEqual([]);
  });
});

describe('handleNear', () => {
  const on = [
    { name: 'slide' as const, at: { x: 20, y: 0 }, from: { x: 0, y: 0 }, to: { x: 40, y: 0 } },
    { name: 'top' as const, at: { x: 20, y: -30 }, from: { x: 20, y: -30 }, to: { x: 20, y: -30 } },
  ];

  it('picks the nearest handle within reach, along an arrow’s shaft', () => {
    expect(handleNear(on, { x: 35, y: 4 }, 10)).toBe('slide');
    expect(handleNear(on, { x: 22, y: -24 }, 10)).toBe('top');
    expect(handleNear(on, { x: 20, y: -16 }, 20)).toBe('top');
  });

  it('prefers an edge handle on a narrow opening’s slide arrow, but not from the arrow’s middle', () => {
    const narrow = [
      { name: 'slide' as const, at: { x: 20, y: 0 }, from: { x: -2, y: 0 }, to: { x: 42, y: 0 } },
      { name: 'end' as const, at: { x: 36, y: 0 }, from: { x: 36, y: 0 }, to: { x: 36, y: 0 } },
    ];
    expect(handleNear(narrow, { x: 36.4, y: 0.3 }, 10)).toBe('end');
    expect(handleNear(narrow, { x: 20, y: 0 }, 24)).toBe('slide');
  });

  it('is null beyond reach', () => {
    expect(handleNear(on, { x: 60, y: 0 }, 10)).toBeNull();
  });
});
