import { type Device, type Edit, type FloorData, type Pt, type Vec3 } from '@el-karta/core';
import { FURNITURE_SIZES, isFurniture, type FurnitureType } from '@el-karta/plugin-furnishing';
import type { SelectionItem } from '@/features/floorplan/canvas/selection';
import { storeDevice } from '@/features/devices/device-edits';
import { movedDevice } from '@/features/devices/device-site';
import type { SizedFootprint } from '@/features/devices/placement';

/** A piece of furniture: a device of the furnishing plugin standing on the floor. */
export type Furniture = Device & {
  placement: Extract<Device['placement'], { kind: 'floor' }>;
};

export const asFurniture = (device: Device | undefined): Furniture | null =>
  device && isFurniture(device) && device.placement.kind === 'floor' ? (device as Furniture) : null;

/** The selected furniture on a floor. */
export const selectedFurniture = (
  floor: FloorData,
  selection: readonly SelectionItem[],
): Furniture[] =>
  selection.flatMap((s) => {
    const item = s.collection === 'devices' ? asFurniture(floor.devices[s.id]) : null;
    return item ? [item] : [];
  });

/** Degrees in [0, 360). */
export const normalizeDegrees = (degrees: number) => {
  const d = degrees % 360;
  return d < 0 ? d + 360 : d === 0 ? 0 : d;
};

/**
 * Where the rotation knob of a footprint sits: `gap` metres behind its back edge (its local -y
 * side), with the middle of that edge, for the line drawn between them.
 */
export function knobPlacement(
  { center, size, rotation }: SizedFootprint,
  gap: number,
): { edge: Pt; knob: Pt } {
  const back = { x: Math.sin(rotation), y: -Math.cos(rotation) };
  const reach = size.y / 2 + gap;
  return {
    edge: { x: center.x + (back.x * size.y) / 2, y: center.y + (back.y * size.y) / 2 },
    knob: { x: center.x + back.x * reach, y: center.y + back.y * reach },
  };
}

/**
 * The rotation that turns the item's back (its local -y side, where the rotation handle sits)
 * towards `pointer`, rounded to `step` degrees unless `step` is 0.
 */
export function rotationTowards(center: Pt, pointer: Pt, step: number): number {
  const angle = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
  return normalizeDegrees(step > 0 ? Math.round(angle / step) * step : angle);
}

/**
 * The item moved to `at`, in the room it then stands in. Moved out of every room it keeps its
 * room, since `updateDevice` cannot clear an optional field.
 */
export const movedTo = (floor: FloorData, item: Furniture, at: Pt): Furniture =>
  asFurniture(movedDevice(floor, item, at, 0) ?? undefined) ?? item;

export const withPlacement = (
  item: Furniture,
  changes: { rotation?: number; size?: Vec3 },
): Furniture => ({ ...item, placement: { ...item.placement, ...changes } });

const sameSize = (a: Vec3 | undefined, b: Vec3) => !!a && a.x === b.x && a.y === b.y && a.z === b.z;

/** The item as another type. Its size follows the new type's default unless it was resized. */
export function withType(item: Furniture, type: FurnitureType): Furniture {
  const old = FURNITURE_SIZES[item.type as FurnitureType];
  const resized = !sameSize(item.placement.size, old);
  return {
    ...item,
    type,
    placement: resized ? item.placement : { ...item.placement, size: { ...FURNITURE_SIZES[type] } },
  };
}

/** One undoable edit that stores `after` over the device with its id. */
export const storeFurniture = (after: Furniture): Edit => storeDevice(after);
