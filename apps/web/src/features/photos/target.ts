import {
  roomAt,
  roomsBesideWall,
  type AttachmentRegion,
  type FloorData,
  type Id,
  type Pt,
  type RoomBesideWall,
} from '@el-karta/core';
import type { SelectionItem } from '@/features/floorplan/canvas/selection';

type Floor = Pick<FloorData, 'walls' | 'rooms'>;

/** What the photo panel adds photos of, from the shared selection (M11 decision 4). */
export type PhotoTarget =
  | { kind: 'none' }
  | { kind: 'room'; roomId: Id }
  /** `rooms` holds each room the wall borders once, in `roomsBesideWall` order; empty for a wall in no room. */
  | { kind: 'wall'; wallId: Id; rooms: readonly RoomBesideWall[] };

const NONE: PhotoTarget = { kind: 'none' };

/** The one selected room or wall; anything else, or more than one item, targets nothing. */
export function photoTarget(floor: Floor, selection: readonly SelectionItem[]): PhotoTarget {
  if (selection.length !== 1) return NONE;
  const [item] = selection as [SelectionItem];
  if (item.collection === 'rooms' && item.id in floor.rooms)
    return { kind: 'room', roomId: item.id };
  if (item.collection === 'walls' && item.id in floor.walls) {
    const seen = new Set<Id>();
    const rooms = roomsBesideWall(floor, item.id).filter(
      (r) => !seen.has(r.roomId) && (seen.add(r.roomId), true),
    );
    return { kind: 'wall', wallId: item.id, rooms };
  }
  return NONE;
}

/**
 * The room a photo of `target` is taken in: the room itself, or for a wall the chosen room beside
 * it, falling back to the first. Undefined when there is none.
 */
export function targetRoom(target: PhotoTarget, chosenRoomId?: Id): Id | undefined {
  if (target.kind === 'room') return target.roomId;
  if (target.kind === 'none') return undefined;
  return (target.rooms.find((r) => r.roomId === chosenRoomId) ?? target.rooms[0])?.roomId;
}

/** The `attachments.region` of a photo of `target`, or null when it has no room to belong to. */
export function photoRegion(target: PhotoTarget, chosenRoomId?: Id): AttachmentRegion | null {
  const roomId = targetRoom(target, chosenRoomId);
  if (roomId === undefined) return null;
  return target.kind === 'wall' ? { roomId, wallId: target.wallId } : { roomId };
}

/**
 * What a tap with the photo tool selects: the wall or room hit, else the room under the pointer,
 * so a tap on a device or an opening still picks the room it is in.
 */
export function photoTapItem(
  floor: Floor,
  hit: SelectionItem | null,
  world: Pt,
): SelectionItem | null {
  if (hit && (hit.collection === 'walls' || hit.collection === 'rooms')) return hit;
  const roomId = roomAt(floor, world);
  return roomId === undefined ? null : { collection: 'rooms', id: roomId };
}
