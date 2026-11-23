import { Vector3 } from 'three';
import type { Bounds3 } from './geometry/types';
import { toThree } from './meshes/merged';

export const CAMERA_FOV = 45;

/** From the plan's bottom edge, a little to the right and above, so 3D reads like the 2D plan. */
const DIRECTION = new Vector3(0.3, 1, 0.9).normalize();
const UP = new Vector3(0, 1, 0);

const MARGIN = 1.08;

export interface CameraFit {
  position: [number, number, number];
  target: [number, number, number];
  near: number;
  far: number;
}

/**
 * A camera that shows all of `bounds` (plan coordinates, z up), in three.js coordinates, as close
 * as each corner allows. `fov` is the vertical field of view in degrees.
 */
export function fitCamera(bounds: Bounds3, aspect: number, fov = CAMERA_FOV): CameraFit {
  const { min, max } = bounds;
  const center = new Vector3(
    ...toThree({ x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }),
  );
  const tanV = Math.tan((fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  const forward = DIRECTION.clone().negate();
  const right = new Vector3().crossVectors(forward, UP).normalize();
  const up = new Vector3().crossVectors(right, forward);

  // Each corner must lie inside the view frustum: its sideways offset at most tan(fov / 2) times
  // its depth, which is the camera's distance from the centre less the corner's offset towards it.
  let distance = 0.5;
  let radius = 0.5;
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y])
      for (const z of [min.z, max.z]) {
        const offset = new Vector3(...toThree({ x, y, z })).sub(center);
        radius = Math.max(radius, offset.length());
        const towards = offset.dot(DIRECTION);
        distance = Math.max(
          distance,
          towards + (MARGIN * Math.abs(offset.dot(right))) / tanH,
          towards + (MARGIN * Math.abs(offset.dot(up))) / tanV,
        );
      }
  const position = center.clone().addScaledVector(DIRECTION, distance);
  return {
    position: [position.x, position.y, position.z],
    target: [center.x, center.y, center.z],
    // Room to orbit, zoom in and zoom out without clipping.
    near: Math.max(0.01, distance / 1000),
    far: (distance + radius) * 10,
  };
}
