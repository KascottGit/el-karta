import type { Device, FloorData, Id, Pt } from '@el-karta/core';
import { boundsOf, type Rect } from '@/features/floorplan/canvas/rect';
import { hasOwnMarker } from './appearance';
import { drawnPosition, footprintCorners, sizedFootprint } from './placement';

/** How one device is drawn on the plan. */
export interface DeviceMark {
  device: Device;
  /** The marker's position, or the footprint's centre. */
  at: Pt;
  /** The corners of a device drawn at its own size; null for a marker. */
  footprint: readonly Pt[] | null;
}

interface Entry {
  mark: DeviceMark | null;
  /** The wall or room the position was derived from. */
  basis: object | undefined;
}

const byDevice = new WeakMap<Device, Entry>();
const byFloor = new WeakMap<
  FloorData['devices'],
  { walls: FloorData['walls']; rooms: FloorData['rooms']; marks: Readonly<Record<Id, DeviceMark>> }
>();

function basisOf(floor: FloorData, device: Device): object | undefined {
  const { placement } = device;
  if (placement.kind === 'wall') return floor.walls[placement.wallId];
  if (placement.kind === 'ceiling') return floor.rooms[placement.roomId];
  return undefined;
}

/** How a device is drawn on a floor, or null when it is not (in a container, or without a position). */
export function deviceMark(floor: FloorData, device: Device): DeviceMark | null {
  if (!hasOwnMarker(device)) return null;
  const footprint = sizedFootprint(device);
  if (footprint) {
    return {
      device,
      at: footprint.center,
      footprint: footprintCorners(footprint),
    };
  }
  const drawn = drawnPosition(floor, device);
  if (!drawn) return null;
  const { x, y } = drawn.position;
  return { device, at: { x, y }, footprint: null };
}

/**
 * The drawn devices of a floor, keyed by device id. A device in a container or without any
 * position has none. Marks are reused while their device and the wall or room it hangs on are
 * unchanged, and the whole record while the floor's devices, walls and rooms are, so culling and
 * memoized shapes see the same objects after unrelated edits.
 */
export function deviceMarks(floor: FloorData): Readonly<Record<Id, DeviceMark>> {
  const cached = byFloor.get(floor.devices);
  if (cached && cached.walls === floor.walls && cached.rooms === floor.rooms) return cached.marks;
  const marks: Record<Id, DeviceMark> = {};
  for (const device of Object.values(floor.devices)) {
    const basis = basisOf(floor, device);
    let entry = byDevice.get(device);
    if (!entry || entry.basis !== basis) {
      entry = { mark: deviceMark(floor, device), basis };
      byDevice.set(device, entry);
    }
    if (entry.mark) marks[device.id] = entry.mark;
  }
  byFloor.set(floor.devices, { walls: floor.walls, rooms: floor.rooms, marks });
  return marks;
}

export const markBounds = (mark: DeviceMark): Rect | null => boundsOf(mark.footprint ?? [mark.at]);
