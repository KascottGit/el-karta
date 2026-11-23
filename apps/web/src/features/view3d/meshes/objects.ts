import type { Id } from '@el-karta/core';
import { InstancedBufferAttribute, InstancedMesh, Mesh, type Object3D } from 'three';
import { materials } from '../materials';
import { instanceTemplate, type DeviceInstances } from './devices';
import type { FloorMeshes } from './floor-meshes';
import { instancesTarget, mergedTarget } from './pick';

function instancedMesh(floorId: Id, instances: DeviceInstances): InstancedMesh {
  const mesh = new InstancedMesh(
    instanceTemplate(instances.shape).geometry,
    materials().device,
    instances.ids.length,
  );
  mesh.instanceMatrix.array.set(instances.matrices);
  mesh.instanceColor = new InstancedBufferAttribute(instances.colors, 3);
  mesh.computeBoundingSphere();
  mesh.userData['pick'] = instancesTarget(floorId, instances);
  return mesh;
}

/**
 * The three.js objects of a floor's meshes, each pickable: walls and slabs as one mesh each, and
 * one instanced mesh per device shape. They share the floor's geometry, so making them is cheap.
 */
export function floorObjects(meshes: FloorMeshes): Object3D[] {
  const { wall, slab } = materials();
  const walls = new Mesh(meshes.walls.geometry, wall);
  walls.userData['pick'] = mergedTarget(meshes.floorId, 'walls', meshes.walls);
  const slabs = new Mesh(meshes.slabs.geometry, slab);
  slabs.userData['pick'] = mergedTarget(meshes.floorId, 'rooms', meshes.slabs);
  return [walls, slabs, ...meshes.devices.map((d) => instancedMesh(meshes.floorId, d))];
}
