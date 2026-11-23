import type { Device, DeviceTypeDef, DomainPlugin, Id, Pt, Vec3 } from '@el-karta/core';
import { z } from 'zod';

export const FURNISHING_DOMAIN = 'furnishing';

export const FURNITURE_TYPES = [
  'desk',
  'table',
  'shelf',
  'rack_shelving',
  'cabinet',
  'bed',
  'sofa',
] as const;
export type FurnitureType = (typeof FURNITURE_TYPES)[number];

/**
 * A new item's size in metres, as `FloorPlacement.size` (ADR 0008): `x` its width, `y` its depth,
 * `z` its height. Typical Swedish home and office furniture.
 */
export const FURNITURE_SIZES: Readonly<Record<FurnitureType, Vec3>> = {
  desk: { x: 1.4, y: 0.7, z: 0.75 },
  table: { x: 1.6, y: 0.9, z: 0.75 },
  shelf: { x: 0.8, y: 0.3, z: 1.8 },
  rack_shelving: { x: 1.2, y: 0.5, z: 2 },
  cabinet: { x: 1, y: 0.6, z: 2 },
  bed: { x: 1.6, y: 2, z: 0.5 },
  sofa: { x: 2, y: 0.9, z: 0.8 },
};

/** Furniture carries everything it needs in its placement; it has no props. */
export const FurnitureProps = z.object({}).strict();

export const isFurnitureType = (type: string): type is FurnitureType =>
  (FURNITURE_TYPES as readonly string[]).includes(type);

export const isFurniture = (device: Pick<Device, 'domain' | 'type'>): boolean =>
  device.domain === FURNISHING_DOMAIN && isFurnitureType(device.type);

const deviceType = (type: FurnitureType): DeviceTypeDef => ({
  type,
  labelKey: `devices.types.${FURNISHING_DOMAIN}.${type}`,
  icon: type,
  placements: ['floor'],
  defaultPorts: [],
  props: FurnitureProps,
});

/** A new piece of furniture of its type's default size, standing at `at` and facing plan +x. */
export function newFurniture({
  id,
  type,
  at,
  roomId,
}: {
  id: Id;
  type: FurnitureType;
  at: Pt;
  roomId?: Id | undefined;
}): Device {
  return {
    id,
    domain: FURNISHING_DOMAIN,
    type,
    label: '',
    ...(roomId === undefined ? {} : { roomId }),
    placement: { kind: 'floor', at, rotation: 0, size: { ...FURNITURE_SIZES[type] } },
    props: {},
    ports: [],
    provenance: { status: 'manual' },
  };
}

/** Desks, beds, shelves and the like as plain boxes, so rooms are recognisable in 3D (M9). */
export const furnishingPlugin: DomainPlugin = {
  id: FURNISHING_DOMAIN,
  nameKey: 'furnishing.name',
  deviceTypes: FURNITURE_TYPES.map(deviceType),
  connectionKinds: [],
  traceKinds: [],
};
