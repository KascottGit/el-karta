import { wallLength, type Device, type FloorData, type PlacementKind } from '@el-karta/core';
import { POWER_DOMAIN, POWER_TYPES, PowerProps, type PowerType } from '@el-karta/plugin-power';
import { registry } from '@/plugins';
import type { SelectionItem } from '@/features/floorplan/canvas/selection';
import { portsFrom, type DeviceTypeRef } from '@/features/devices/new-device';

/** A device of the power plugin, of one of its registered types. */
export type PowerDevice = Device & { type: PowerType };

const isPowerType = (type: string): type is PowerType =>
  (POWER_TYPES as readonly string[]).includes(type);

export const asPower = (device: Device | undefined): PowerDevice | null =>
  device?.domain === POWER_DOMAIN && isPowerType(device.type) ? (device as PowerDevice) : null;

/** The selected power devices on a floor. */
export const selectedPower = (
  floor: FloorData,
  selection: readonly SelectionItem[],
): PowerDevice[] =>
  selection.flatMap((s) => {
    const device = s.collection === 'devices' ? asPower(floor.devices[s.id]) : null;
    return device ? [device] : [];
  });

export function powerType(type: PowerType): DeviceTypeRef {
  const def = registry.deviceType(POWER_DOMAIN, type);
  if (!def) throw new Error(`Power type ${type} is not registered`);
  return { domain: POWER_DOMAIN, def };
}

/** The types a device with this placement can become without moving: those placed the same way. */
export const typesPlacedOn = (kind: PlacementKind): PowerType[] =>
  POWER_TYPES.filter((type) => powerType(type).def.placements.includes(kind));

/** Only outlets hold several units in one frame (`Device.count`). */
export const hasCount = (type: PowerType) => type === 'outlet';

/**
 * The device as another type placed the same way. Props the new type does not have are dropped,
 * ports it needs are added (existing ones are kept, as connections may use them), and a wall
 * device still at the old type's default height takes the new one's.
 */
export function withPowerType(device: PowerDevice, type: PowerType): PowerDevice {
  if (device.type === type) return device;
  const old = powerType(device.type).def;
  const next = powerType(type);
  const keys = Object.keys(PowerProps[type].shape);
  const props = Object.fromEntries(Object.entries(device.props).filter(([k]) => keys.includes(k)));
  const missing = next.def.defaultPorts.filter(
    (port) => !device.ports.some((p) => p.kind === port.kind),
  );
  const ports = [...device.ports, ...portsFrom(POWER_DOMAIN, missing)];
  const { placement } = device;
  const height = next.def.defaultHeight;
  const reset =
    placement.kind === 'wall' && placement.height === old.defaultHeight && height !== undefined;
  const moved = reset ? withHeight(device, height) : device;
  return { ...moved, type, props, ports };
}

/** The device with one prop set, or removed when `value` is undefined (unknown). */
export function withProp(device: PowerDevice, key: string, value: unknown): PowerDevice {
  const rest = Object.fromEntries(Object.entries(device.props).filter(([k]) => k !== key));
  return { ...device, props: value === undefined ? rest : { ...rest, [key]: value } };
}

/**
 * A wall device moved to `offset` metres from its wall's end `a`, clamped to the wall; unchanged
 * when its wall is missing.
 */
export function withOffset(floor: FloorData, device: PowerDevice, offset: number): PowerDevice {
  const { placement } = device;
  if (placement.kind !== 'wall') return device;
  const wall = floor.walls[placement.wallId];
  if (!wall) return device;
  const clamped = Math.min(wallLength(wall), Math.max(0, offset));
  return { ...device, placement: { ...placement, offset: clamped } };
}

export function withHeight(device: PowerDevice, height: number): PowerDevice {
  const { placement } = device;
  return placement.kind === 'wall' ? { ...device, placement: { ...placement, height } } : device;
}
