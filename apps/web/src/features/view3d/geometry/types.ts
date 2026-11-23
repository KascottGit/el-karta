import type { Id, Pt, Vec3 } from '@el-karta/core';
import type { MarkerShape } from '@/features/devices/appearance';

/**
 * A box in plan coordinates with z measured from the floor's surface (see `../README.md`).
 * `size.x` runs along the box's own x axis (a wall's length), `size.y` across it (a wall's
 * thickness) and `size.z` is the height. `rotation` turns the box's x axis from plan +x towards
 * plan +y, in radians.
 */
export interface Box {
  center: Vec3;
  size: Vec3;
  rotation: number;
}

export interface WallPiece extends Box {
  wallId: Id;
}

/** A room's floor slab: its outline at the floor's surface. Triangulated by the renderer. */
export interface RoomSlab {
  roomId: Id;
  outline: readonly Pt[];
}

/** A device with a floor placement and a `size`, drawn as a box standing on the floor. */
export interface DeviceBox extends Box {
  kind: 'box';
  deviceId: Id;
  color: string;
  flagged: false;
}

/**
 * Any other device, drawn as a generic marker at `position`. `facing` is the unit vector the
 * marker faces: out of the wall face for wall placements, down for ceiling, up for floor.
 * `flagged` devices have no valid placement and sit at their approximate position.
 */
export interface DeviceMarker {
  kind: 'marker';
  deviceId: Id;
  position: Vec3;
  facing: Vec3;
  shape: MarkerShape;
  color: string;
  flagged: boolean;
}

export type DeviceTransform = DeviceBox | DeviceMarker;

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

/** Everything drawn for one floor, in floor-local coordinates. */
export interface FloorGeometry {
  walls: WallPiece[];
  slabs: RoomSlab[];
  devices: DeviceTransform[];
  bounds: Bounds3 | null;
}
