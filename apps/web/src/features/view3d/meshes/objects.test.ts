import type { FloorRecord } from '@el-karta/core';
import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { projectWith } from '@/features/floorplan/walls/test-fixtures';
import { FloorFixture, pt } from '../geometry/test-fixtures';
import { materials } from '../materials';
import { floorMeshes } from './floor-meshes';
import { floorObjects } from './objects';
import { itemOfHit } from './pick';

describe('floorObjects', () => {
  it('draws each opening with its kind’s material and picks it by face', () => {
    const fixture = new FloorFixture(2.5);
    const wall = fixture.wall(pt(0, 0), pt(8, 0));
    const openings = [
      fixture.opening(wall.id, 'passage', 0.5, 1, 2.1),
      fixture.opening(wall.id, 'window', 2, 1.2, 1.2, 0.9),
      fixture.opening(wall.id, 'door', 4, 0.9, 2.1),
    ];
    const { model, floorId } = projectWith();
    const floor: FloorRecord = { ...model.floors[floorId]!, data: fixture.data };
    const meshes = floorMeshes(floor);
    const mesh = floorObjects(meshes).find(
      (o): o is Mesh => o instanceof Mesh && o.geometry === meshes.openings.geometry,
    )!;
    const materialOf = mesh.material as readonly unknown[];
    for (const opening of openings) {
      const range = meshes.openings.ranges.get(opening.id)!;
      const group = mesh.geometry.groups.find(
        (g) => g.start <= range.start * 3 && g.start + g.count >= (range.start + range.count) * 3,
      )!;
      expect(materialOf[group.materialIndex!], opening.kind).toBe(
        materials().opening[opening.kind],
      );
      expect(itemOfHit({ object: mesh, faceIndex: range.start + 1 })).toEqual({
        floorId,
        collection: 'openings',
        id: opening.id,
      });
    }
  });
});
