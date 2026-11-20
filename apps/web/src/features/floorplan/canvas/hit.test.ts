import type Konva from 'konva';
import { describe, expect, it, vi } from 'vitest';
import type { Handle, ResolvedExtensions } from './extension';
import {
  handle,
  handleAt,
  handleName,
  invalidateHitGraph,
  itemAt,
  nodeProps,
  samplePoints,
  selectable,
  selectableCollection,
  TOUCH_RADIUS,
} from './hit';

describe('hit sampling', () => {
  it('tries only the point itself for a mouse', () => {
    expect(samplePoints({ x: 5, y: 6 }, 0)).toEqual([{ x: 5, y: 6 }]);
  });

  it('tries the point first, then rings at half and full finger radius', () => {
    const center = { x: 100, y: 50 };
    const points = samplePoints(center, TOUCH_RADIUS);
    expect(points[0]).toEqual(center);
    const distances = points.slice(1).map((p) => Math.hypot(p.x - center.x, p.y - center.y));
    expect(distances.slice(0, 8).every((d) => Math.abs(d - TOUCH_RADIUS / 2) < 1e-9)).toBe(true);
    expect(distances.slice(8).every((d) => Math.abs(d - TOUCH_RADIUS) < 1e-9)).toBe(true);
    expect(points).toHaveLength(17);
  });
});

describe('node names', () => {
  const opening: Handle<{ id: string }> = { name: 'opening-slide', onDrag: () => {} };

  it('marks a node selectable or as a handle, and reads both back', () => {
    const sel = selectable('walls', 'w1');
    expect(sel).toEqual({ id: 'w1', name: 'selectable:walls' });
    expect(selectableCollection(sel.name)).toBe('walls');
    expect(handleName(sel.name)).toBeUndefined();
    const h = handle(opening, { id: 'o1' });
    expect(handleName(h.name)).toBe('opening-slide');
    expect(selectableCollection(h.name)).toBeUndefined();
  });

  it('combines both on one node, keeping the id, both names and the payload', () => {
    const props = nodeProps(selectable('openings', 'o1'), handle(opening, { id: 'o1' }));
    expect(props).toEqual({
      id: 'o1',
      name: 'selectable:openings handle:opening-slide',
      handlePayload: { id: 'o1' },
    });
    expect(selectableCollection(props.name)).toBe('openings');
    expect(handleName(props.name)).toBe('opening-slide');
  });

  it('ignores names that are not a known collection', () => {
    expect(selectableCollection('selectable:nonsense layer-walls')).toBeUndefined();
  });
});

describe('lazy hit graph', () => {
  function fakeStage() {
    const calls: string[] = [];
    const layer = (name: string) => ({ drawHit: vi.fn(() => calls.push(`drawHit:${name}`)) });
    const layers = [layer('a'), layer('b'), layer('c')];
    const stage = {
      getLayers: () => layers,
      getIntersection: vi.fn(() => {
        calls.push('getIntersection');
        return null;
      }),
    };
    return { stage: stage as unknown as Konva.Stage, layers, calls };
  }
  const registry = { handles: new Map() } as unknown as ResolvedExtensions;

  it.each([
    ['itemAt', (stage: Konva.Stage) => itemAt(stage, { x: 1, y: 2 }, 'mouse')],
    ['handleAt', (stage: Konva.Stage) => handleAt(stage, { x: 1, y: 2 }, 'mouse', registry)],
  ])('%s redraws every layer once after the view moved, before hit-testing', (_, find) => {
    const { stage, layers, calls } = fakeStage();
    invalidateHitGraph(stage);
    find(stage);
    expect(calls).toEqual(['drawHit:a', 'drawHit:b', 'drawHit:c', 'getIntersection']);
    find(stage);
    for (const layer of layers) expect(layer.drawHit).toHaveBeenCalledTimes(1);
    expect(calls.slice(4)).toEqual(['getIntersection']);
  });
});
