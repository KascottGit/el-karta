import type { Pt, Room } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { resolveExtensions } from '../canvas/extension';
import { extensions } from '../extensions';
import { checkPolygon, reshapePolygon, withCeilingHeight } from './area-edits';

const pt = (x: number, y: number): Pt => ({ x, y });
const square = [pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4)];

describe('reshaping a polygon', () => {
  it('moves a vertex', () => {
    expect(reshapePolygon(square, { kind: 'move', index: 2 }, pt(5, 5), 0.1)).toEqual([
      pt(0, 0),
      pt(4, 0),
      pt(5, 5),
      pt(0, 4),
    ]);
  });

  it('inserts a vertex after the dragged midpoint’s first corner', () => {
    expect(reshapePolygon(square, { kind: 'insert', index: 3 }, pt(-1, 2), 0.1)).toEqual([
      ...square,
      pt(-1, 2),
    ]);
  });

  it('removes a vertex dropped on either neighbour, but not below three', () => {
    expect(reshapePolygon(square, { kind: 'move', index: 0 }, pt(0.05, 3.98), 0.1)).toEqual([
      pt(4, 0),
      pt(4, 4),
      pt(0, 4),
    ]);
    expect(reshapePolygon(square, { kind: 'move', index: 0 }, pt(4, 0), 0.1)).toHaveLength(3);
    expect(reshapePolygon(square.slice(0, 3), { kind: 'move', index: 0 }, pt(4, 0), 0.1)).toBe(
      null,
    );
  });

  it('checks the result', () => {
    expect(checkPolygon(null)).toEqual({ ok: false, problem: 'too-few-points' });
    expect(checkPolygon([pt(0, 0), pt(4, 4), pt(4, 0), pt(0, 4)])).toEqual({
      ok: false,
      problem: 'self-intersecting',
    });
    expect(checkPolygon(square)).toEqual({ ok: true, polygon: square });
  });
});

describe('room fields', () => {
  const room: Room = {
    id: 'r',
    name: 'Kök',
    type: 'kitchen',
    polygon: square,
    provenance: { status: 'manual' },
  };

  it('sets and clears the ceiling height, keeping the same object when nothing changes', () => {
    const high = withCeilingHeight(room, 2.7);
    expect(high.ceilingHeight).toBe(2.7);
    expect(withCeilingHeight(high, 2.7)).toBe(high);
    expect('ceilingHeight' in withCeilingHeight(high, undefined)).toBe(false);
    expect(withCeilingHeight(room, undefined)).toBe(room);
  });
});

describe('areas extension', () => {
  it('registers without clashing ids or shortcuts', () => {
    const registry = resolveExtensions(extensions);
    expect(registry.tool('room').id).toBe('room');
    expect(registry.tool('fill-room').id).toBe('fill-room');
    expect(registry.tool('zone').id).toBe('zone');
    expect(registry.handles.has('area-vertex')).toBe(true);
  });
});
