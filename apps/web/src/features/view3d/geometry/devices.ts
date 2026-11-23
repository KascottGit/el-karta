import {
  leftNormal,
  resolvePlacement,
  sub,
  type Device,
  type FloorData,
  type Vec3,
} from '@el-karta/core';
import { deviceAppearance, hasOwnMarker } from '@/features/devices/appearance';
import type { DeviceTransform } from './types';

const UP: Vec3 = { x: 0, y: 0, z: 1 };
const DOWN: Vec3 = { x: 0, y: 0, z: -1 };

const degrees = (d: number) => (d * Math.PI) / 180;

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
  const { placement } = device;
  const { shape, color } = deviceAppearance(device);

  if (placement.kind === 'floor' && placement.size && isSolid(placement.size)) {
    const { size } = placement;
    return {
      kind: 'box',
      deviceId: device.id,
      center: { x: placement.at.x, y: placement.at.y, z: size.z / 2 },
      size,
      rotation: degrees(placement.rotation ?? 0),
      color,
      flagged: false,
    };
  }

  const resolved = resolvePlacement(floor, device);
  const absolute = resolved.ok ? resolved.position : resolved.approximate;
  if (!absolute) return null;
  return {
    kind: 'marker',
    deviceId: device.id,
    position: { ...absolute, z: absolute.z - floor.elevation },
    facing: facingOf(floor, device) ?? UP,
    shape,
    color,
    flagged: !resolved.ok,
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

const isSolid = (size: Vec3) => size.x > 0 && size.y > 0 && size.z > 0;
