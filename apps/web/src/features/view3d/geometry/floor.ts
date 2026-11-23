import type { FloorData } from '@el-karta/core';
import { floorBounds } from './bounds';
import { deviceTransforms } from './devices';
import { roomSlabs } from './rooms';
import type { FloorGeometry } from './types';
import { wallPieces } from './walls';

/** Everything the 3D view draws for one floor, in floor-local coordinates. */
export function buildFloorGeometry(floor: FloorData): FloorGeometry {
  const walls = wallPieces(floor);
  const slabs = roomSlabs(floor);
  const devices = deviceTransforms(floor);
  return { walls, slabs, devices, bounds: floorBounds(walls, slabs, devices) };
}
