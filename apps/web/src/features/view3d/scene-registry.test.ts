import type { FloorRecord } from '@el-karta/core';
import { Group, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { projectWith } from '@/features/floorplan/walls/test-fixtures';
import { FloorFixture, pt } from './geometry/test-fixtures';
import { floorMeshes } from './meshes/floor-meshes';
import { floorObjects } from './meshes/objects';
import { SceneRegistry } from './scene-registry';

const SIZE = { width: 800, height: 600 };

/** A 6 × 4 m room closed by a wall along its south side (plan y = 4), with two outlets. */
function scene(base = 0) {
  const fixture = new FloorFixture(2.5);
  const south = fixture.wall(pt(0, 4), pt(6, 4), { thickness: 0.2 });
  const room = fixture.room([pt(0, 0), pt(6, 0), pt(6, 4), pt(0, 4)]);
  // Left of a → b (+x) is plan -y: the inside of the room, hidden behind the wall from the south.
  const inside = fixture.device({
    kind: 'wall',
    wallId: south.id,
    offset: 3,
    height: 0.3,
    side: 'left',
  });
  const outside = fixture.device({
    kind: 'wall',
    wallId: south.id,
    offset: 3,
    height: 1.2,
    side: 'right',
  });
  const { model, floorId } = projectWith();
  const floor: FloorRecord = { ...model.floors[floorId]!, data: fixture.data };

  const meshes = floorMeshes(floor);
  const group = new Group();
  group.position.y = base;
  const pickables = floorObjects(meshes);
  group.add(...pickables);
  const registry = new SceneRegistry();
  registry.floors.set(floorId, { group, base, meshes, pickables });

  // South of the room and above it, looking north over the wall.
  const camera = new PerspectiveCamera(50, SIZE.width / SIZE.height, 0.1, 100);
  camera.position.set(3, base + 14, 10);
  camera.lookAt(3, base + 0.5, 2);
  camera.updateMatrixWorld();
  const item = (collection: 'walls' | 'rooms' | 'devices', id: string) => ({
    floorId,
    collection,
    id,
  });
  return { registry, camera, item, south, room, inside, outside };
}

describe('SceneRegistry', () => {
  it('finds a point on each visible item where a tap picks it', () => {
    for (const base of [0, 7.5]) {
      const { registry, camera, item, south, room, outside } = scene(base);
      for (const target of [
        item('walls', south.id),
        item('rooms', room.id),
        item('devices', outside.id),
      ]) {
        const at = registry.screenPosition(camera, SIZE, target);
        expect(at, target.collection).not.toBeNull();
        expect(registry.pick(camera, SIZE, at!.x, at!.y)).toEqual(target);
      }
    }
  });

  it('has no point for an item covered by another', () => {
    const { registry, camera, item, inside } = scene();
    expect(registry.screenPosition(camera, SIZE, item('devices', inside.id))).toBeNull();
  });

  it('picks nothing in empty space', () => {
    const { registry, camera } = scene();
    expect(registry.pick(camera, SIZE, 2, 2)).toBeNull();
  });
});
