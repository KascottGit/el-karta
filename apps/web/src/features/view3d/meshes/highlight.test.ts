import type { FloorRecord } from '@el-karta/core';
import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import { projectWith } from '@/features/floorplan/walls/test-fixtures';
import { FloorFixture, pt } from '../geometry/test-fixtures';
import { floorMeshes } from './floor-meshes';
import { HIGHLIGHT_INFLATE, highlightGeometry } from './highlight';

function floor() {
  const fixture = new FloorFixture(2.5);
  const wall = fixture.wall(pt(0, 0), pt(4, 0), { thickness: 0.2 });
  fixture.wall(pt(0, 3), pt(4, 3), { thickness: 0.2 });
  const room = fixture.room([pt(0, 0), pt(4, 0), pt(4, 3), pt(0, 3)]);
  const desk = fixture.device(
    { kind: 'floor', at: pt(2, 1.5), size: { x: 1.2, y: 0.6, z: 0.7 } },
    { domain: 'furnishing', type: 'desk' },
  );
  const { model, floorId } = projectWith();
  const record: FloorRecord = { ...model.floors[floorId]!, data: fixture.data };
  return { meshes: floorMeshes(record), wall, room, desk };
}

const boundsOf = (h: ReturnType<typeof highlightGeometry>) =>
  new Box3().setFromBufferAttribute(h!.geometry.getAttribute('position') as never);

describe('highlightGeometry', () => {
  it('is null without a selection drawn on the floor', () => {
    const { meshes } = floor();
    expect(highlightGeometry(meshes, [])).toBeNull();
    expect(highlightGeometry(meshes, [{ collection: 'walls', id: 'gone' }])).toBeNull();
    expect(highlightGeometry(meshes, [{ collection: 'openings', id: 'x' }])).toBeNull();
  });

  it('covers a selected wall, standing out of each face', () => {
    const { meshes, wall } = floor();
    const h = highlightGeometry(meshes, [{ collection: 'walls', id: wall.id }]);
    expect(h?.items).toEqual([{ collection: 'walls', id: wall.id }]);
    expect(h!.geometry.getAttribute('position').count).toBe(
      meshes.walls.ranges.get(wall.id)!.count * 3,
    );
    const box = boundsOf(h);
    const e = HIGHLIGHT_INFLATE;
    // The free wall ends are not extended; three.js z is plan y.
    expect([box.min.x, box.max.x]).toEqual([expect.closeTo(-e), expect.closeTo(4 + e)]);
    expect([box.min.z, box.max.z]).toEqual([expect.closeTo(-0.1 - e), expect.closeTo(0.1 + e)]);
    expect([box.min.y, box.max.y]).toEqual([expect.closeTo(-e), expect.closeTo(2.5 + e)]);
  });

  it('lifts a selected room’s slab and covers a selected device box', () => {
    const { meshes, room, desk } = floor();
    const slab = highlightGeometry(meshes, [{ collection: 'rooms', id: room.id }]);
    expect(boundsOf(slab).min.y).toBeCloseTo(HIGHLIGHT_INFLATE);
    const box = boundsOf(highlightGeometry(meshes, [{ collection: 'devices', id: desk.id }]));
    expect(box.max.y).toBeCloseTo(0.7 + HIGHLIGHT_INFLATE);
    expect(box.max.x - box.min.x).toBeCloseTo(1.2 + 2 * HIGHLIGHT_INFLATE);
  });
});
