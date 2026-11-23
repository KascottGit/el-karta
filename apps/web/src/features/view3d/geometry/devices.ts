import { leftNormal, sub, type Device, type FloorData, type Vec3 } from '@el-karta/core';
import { deviceAppearance, hasOwnMarker } from '@/features/devices/appearance';
import { drawnPosition, sizedFootprint } from '@/features/devices/placement';
import type { DeviceTransform } from './types';

const UP: Vec3 = { x: 0, y: 0, z: 1 };
const DOWN: Vec3 = { x: 0, y: 0, z: -1 };

/**
 * Where each device of the floor is drawn. Devices in a container have none, and a device that
 * cannot be placed is drawn at its approximate position, flagged, or not at all without one.
 */
export function deviceTransforms(floor: FloorData): DeviceTransform[] {
  const out: DeviceTransform[] = [];
  for (const device of Object.values(floor.devices)) {
    const transform = deviceTransform(floor, device);
    if (transform) out.push(transform);
  }
  return out;
}

function deviceTransform(floor: FloorData, device: Device): DeviceTransform | null {
  if (!hasOwnMarker(device)) return null;
  const { shape, color } = deviceAppearance(device);

  const footprint = sizedFootprint(device);
  if (footprint) {
    const { center, size, rotation } = footprint;
    return {
      kind: 'box',
      deviceId: device.id,
      center: { ...center, z: size.z / 2 },
      size,
      rotation,
      color,
      flagged: false,
    };
  }

  const drawn = drawnPosition(floor, device);
  if (!drawn) return null;
  const { position, flagged } = drawn;
  return {
    kind: 'marker',
    deviceId: device.id,
    position: { ...position, z: position.z - floor.elevation },
    facing: facingOf(floor, device) ?? UP,
    shape,
    color,
    flagged,
  };
}

function facingOf(floor: FloorData, device: Device): Vec3 | null {
  const { placement } = device;
  switch (placement.kind) {
    case 'wall': {
      const wall = floor.walls[placement.wallId];
      if (!wall) return null;
      const n = leftNormal(sub(wall.b, wall.a));
      const sign = placement.side === 'left' ? 1 : -1;
      return { x: n.x * sign, y: n.y * sign, z: 0 };
    }
    case 'ceiling':
      return DOWN;
    case 'floor':
    case 'container':
      return UP;
  }
}
