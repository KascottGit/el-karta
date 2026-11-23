import type { FloorCollection, Id } from '@el-karta/core';
import type { Intersection } from 'three';
import type { View3dItem } from '../dev-hook-types';
import type { DeviceInstances } from './devices';
import type { MergedMesh } from './merged';

type Hit = Pick<Intersection, 'faceIndex' | 'instanceId'>;

/** What a pickable mesh carries in `userData.pick`: how a hit maps back to an item. */
export interface PickTarget {
  floorId: Id;
  collection: FloorCollection;
  idOf: (hit: Hit) => Id | undefined;
}

export const mergedTarget = (
  floorId: Id,
  collection: FloorCollection,
  mesh: MergedMesh,
): PickTarget => ({
  floorId,
  collection,
  idOf: ({ faceIndex }) => {
    if (faceIndex == null) return undefined;
    const item = mesh.itemOf[faceIndex];
    return item === undefined ? undefined : mesh.ids[item];
  },
});

export const instancesTarget = (floorId: Id, instances: DeviceInstances): PickTarget => ({
  floorId,
  collection: 'devices',
  idOf: ({ instanceId }) => (instanceId === undefined ? undefined : instances.ids[instanceId]),
});

const isTarget = (value: unknown): value is PickTarget =>
  typeof value === 'object' && value !== null && 'idOf' in value;

/** The item a raycast hit, or null when the hit object is not pickable. */
export function itemOfHit(hit: Hit & Pick<Intersection, 'object'>): View3dItem | null {
  const target: unknown = hit.object.userData['pick'];
  if (!isTarget(target)) return null;
  const id = target.idOf(hit);
  return id === undefined ? null : { floorId: target.floorId, collection: target.collection, id };
}
