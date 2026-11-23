import type { Pt, Vec3 } from '@el-karta/core';
import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three';
import { CAMERA_FOV } from '../camera';
import { toThree } from '../meshes/merged';
import { HANDLE_PX, type GizmoHandle, type ScreenHandle } from './handles';
import { metresPerPixel, planRay, type Ray } from './ray';

export interface Size {
  width: number;
  height: number;
}

/** A floor-local plan point in three.js world coordinates, on the floor drawn by `group`. */
export const worldOf = (group: Object3D, at: Vec3) =>
  new Vector3(...toThree(at)).applyMatrix4(group.matrixWorld);

/** Metres per CSS pixel at a world point, so a handle there can keep its size on screen. */
export function pixelSize(camera: Camera, size: Size, world: Vector3): number {
  const depth = -world.clone().applyMatrix4(camera.matrixWorldInverse).z;
  const fov = 'fov' in camera && typeof camera.fov === 'number' ? camera.fov : CAMERA_FOV;
  return metresPerPixel(Math.max(depth, 1e-3), fov, size.height);
}

/** A world point in canvas CSS pixels, or null when it is behind the camera. */
export function toScreen(camera: Camera, size: Size, world: Vector3): Pt | null {
  const ndc = world.clone().project(camera);
  if (ndc.z > 1) return null;
  return { x: ((ndc.x + 1) / 2) * size.width, y: ((1 - ndc.y) / 2) * size.height };
}

/** The handles as drawn on screen; an arrow as its shaft, anything else as its centre. */
export function screenHandles(
  camera: Camera,
  size: Size,
  group: Object3D,
  handles: readonly GizmoHandle[],
): ScreenHandle[] {
  camera.updateMatrixWorld();
  group.updateWorldMatrix(true, false);
  return handles.flatMap((h) => {
    const centre = worldOf(group, h.at);
    const half =
      h.shape === 'arrow' && h.constraint.kind === 'axis'
        ? new Vector3(...toThree(h.constraint.dir)).multiplyScalar(
            (HANDLE_PX.arrow / 2) * pixelSize(camera, size, centre),
          )
        : new Vector3();
    const at = toScreen(camera, size, centre);
    const from = toScreen(camera, size, centre.clone().sub(half));
    const to = toScreen(camera, size, centre.clone().add(half));
    return at && from && to ? [{ name: h.name, at, from, to }] : [];
  });
}

const raycaster = new Raycaster();

/** The pointer ray at `(x, y)` canvas pixels, in plan coordinates of a floor drawn at `base`. */
export function pointerRay(camera: Camera, size: Size, x: number, y: number, base: number): Ray {
  camera.updateMatrixWorld();
  raycaster.setFromCamera(new Vector2((x / size.width) * 2 - 1, 1 - (y / size.height) * 2), camera);
  return planRay(raycaster.ray.origin, raycaster.ray.direction, base);
}
