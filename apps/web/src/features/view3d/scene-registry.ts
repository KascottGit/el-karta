import type { Id } from '@el-karta/core';
import { Matrix4, Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three';
import { sameItem, type SelectionItem } from '@/features/floorplan/canvas/selection';
import type { View3dItem } from './dev-hook-types';
import type { FloorMeshes } from './meshes/floor-meshes';
import type { MergedMesh } from './meshes/merged';
import { itemOfHit } from './meshes/pick';

export interface FloorEntry {
  /** The floor's group, raised to its base. */
  group: Object3D;
  base: number;
  meshes: FloorMeshes;
  /** The meshes a tap can hit; each carries a `PickTarget` in `userData.pick`. */
  pickables: readonly Object3D[];
}

interface Size {
  width: number;
  height: number;
}

const raycaster = new Raycaster();

/**
 * Points on an item's triangles, largest triangles first, in floor-local three.js coordinates:
 * each centroid and the points halfway from it to the corners, so a partly covered face still has
 * some in view.
 */
function trianglePoints(mesh: MergedMesh, id: Id): Vector3[] {
  const range = mesh.ranges.get(id);
  const index = mesh.geometry.getIndex();
  const position = mesh.geometry.getAttribute('position');
  if (!range || !index) return [];
  const out: { points: Vector3[]; area: number }[] = [];
  const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
  for (let t = range.start; t < range.start + range.count; t++) {
    a.fromBufferAttribute(position, index.getX(t * 3));
    b.fromBufferAttribute(position, index.getX(t * 3 + 1));
    c.fromBufferAttribute(position, index.getX(t * 3 + 2));
    const area = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).length();
    const centroid = a.clone().add(b).add(c).divideScalar(3);
    const points = [centroid, ...[a, b, c].map((v) => centroid.clone().lerp(v, 0.5))];
    out.push({ points, area });
  }
  return out.sort((p, q) => q.area - p.area).flatMap((p) => p.points);
}

function instancePositions(meshes: FloorMeshes, id: Id): Vector3[] {
  const m = new Matrix4();
  for (const group of meshes.devices) {
    const i = group.ids.indexOf(id);
    if (i >= 0) return [new Vector3().setFromMatrixPosition(m.fromArray(group.matrices, i * 16))];
  }
  return [];
}

/**
 * The floors the 3D view has drawn, for picking and for the e2e dev hook. Floor components add
 * and remove their entries as they mount and unmount.
 */
export class SceneRegistry {
  readonly floors = new Map<Id, FloorEntry>();
  /** The selected items each floor's highlight draws. */
  readonly highlights = new Map<Id, readonly SelectionItem[]>();

  /** The item drawn nearest the camera at `(x, y)` in canvas pixels, or null. */
  pick(camera: Camera, size: Size, x: number, y: number): View3dItem | null {
    if (size.width === 0 || size.height === 0) return null;
    // The camera or a floor may have moved since the last frame was drawn.
    camera.updateMatrixWorld();
    for (const entry of this.floors.values()) entry.group.updateWorldMatrix(true, true);
    raycaster.setFromCamera(
      new Vector2((x / size.width) * 2 - 1, 1 - (y / size.height) * 2),
      camera,
    );
    const objects = [...this.floors.values()].flatMap((e) => e.pickables);
    for (const hit of raycaster.intersectObjects(objects, false)) {
      const item = itemOfHit(hit);
      if (item) return item;
    }
    return null;
  }

  /**
   * A point in canvas pixels where a tap picks `item`: on one of its faces or at its marker, in
   * view and not covered by anything else. Null when there is none.
   */
  screenPosition(camera: Camera, size: Size, item: View3dItem): { x: number; y: number } | null {
    const entry = this.floors.get(item.floorId);
    if (!entry) return null;
    const { meshes, group } = entry;
    const candidates =
      item.collection === 'walls'
        ? trianglePoints(meshes.walls, item.id)
        : item.collection === 'rooms'
          ? trianglePoints(meshes.slabs, item.id)
          : item.collection === 'devices'
            ? instancePositions(meshes, item.id)
            : [];
    camera.updateMatrixWorld();
    group.updateWorldMatrix(true, false);
    for (const local of candidates) {
      const ndc = group.localToWorld(local).project(camera);
      if (Math.abs(ndc.x) > 0.98 || Math.abs(ndc.y) > 0.98 || ndc.z > 1) continue;
      const x = ((ndc.x + 1) / 2) * size.width;
      const y = ((1 - ndc.y) / 2) * size.height;
      const hit = this.pick(camera, size, x, y);
      if (hit && hit.floorId === item.floorId && sameItem(hit, item)) return { x, y };
    }
    return null;
  }

  highlighted(): View3dItem[] {
    return [...this.highlights].flatMap(([floorId, items]) =>
      items.map((i) => ({ floorId, collection: i.collection, id: i.id })),
    );
  }
}
