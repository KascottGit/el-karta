import {
  deviceTypeKey,
  type PhotoDetectableInput,
  type PhotoInput,
  type PhotoSuggestOptions,
  type PhotoWall,
} from '@el-karta/ai-passes';
import {
  centroid,
  closestOnSegment,
  roomsBesideWall,
  type AttachmentRegion,
  type Device,
  type FloorData,
  type Id,
  type Suggestion,
} from '@el-karta/core';
import type { Attachment } from '@el-karta/data-supabase';

/** What the photo pass gets besides the images (M11 decision 7). */
export type PhotoContext = Omit<PhotoInput, 'image' | 'earlier'>;

/** At most this many earlier photos go with a photo, for context. */
export const MAX_EARLIER = 3;
/** The prompt names walls by letter. */
const MAX_WALLS = 26;

type Floor = Pick<FloorData, 'walls' | 'rooms' | 'openings' | 'devices' | 'height'>;

/**
 * The walls bordering `roomId`, with the face that looks into it, clockwise on the plan (as seen
 * from above, y down) around the room's centroid and starting at `firstWallId` when it is one of
 * them, so the wall a photo shows is always wall A.
 */
export function roomWalls(floor: Floor, roomId: Id, firstWallId?: Id): PhotoWall[] {
  const room = floor.rooms[roomId];
  if (!room || room.polygon.length < 3) return [];
  const xs = room.polygon.map((p) => p.x);
  const ys = room.polygon.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const centre = centroid(room.polygon);
  const found: { wall: PhotoWall; angle: number }[] = [];
  for (const wall of Object.values(floor.walls)) {
    // Only walls near the room's bounds can border it; probing every wall would scale with the floor.
    const pad = wall.thickness;
    if (
      Math.max(wall.a.x, wall.b.x) < minX - pad ||
      Math.min(wall.a.x, wall.b.x) > maxX + pad ||
      Math.max(wall.a.y, wall.b.y) < minY - pad ||
      Math.min(wall.a.y, wall.b.y) > maxY + pad
    )
      continue;
    const beside = roomsBesideWall(floor, wall.id).find((r) => r.roomId === roomId);
    if (!beside) continue;
    const near = closestOnSegment(centre, wall.a, wall.b).point;
    found.push({
      wall: { id: wall.id, a: wall.a, b: wall.b, thickness: wall.thickness, side: beside.side },
      angle: Math.atan2(near.y - centre.y, near.x - centre.x),
    });
  }
  // With y down, a growing angle turns clockwise on the plan.
  const sorted = found.sort((p, q) => p.angle - q.angle).map((f) => f.wall);
  const first = Math.max(
    0,
    sorted.findIndex((w) => w.id === firstWallId),
  );
  return [...sorted.slice(first), ...sorted.slice(0, first)].slice(0, MAX_WALLS);
}

/**
 * The pass input for a photo of `region` without its images: the room, its walls, the openings in
 * them and the room's devices of the types photos can show. Null when the room is gone or has no
 * walls to place anything on.
 */
export function photoContext(
  floor: Floor,
  region: AttachmentRegion,
  detectable: readonly PhotoDetectableInput[],
): PhotoContext | null {
  const room = floor.rooms[region.roomId];
  if (!room || detectable.length === 0) return null;
  const walls = roomWalls(floor, room.id, region.wallId);
  if (walls.length === 0) return null;
  const faces = new Map(walls.map((w) => [w.id, w.side]));
  const types = new Set(detectable.map(deviceTypeKey));
  const inRoom = (d: Device) => {
    const p = d.placement;
    if (p.kind === 'wall') return faces.get(p.wallId) === p.side;
    if (p.kind === 'ceiling') return p.roomId === room.id;
    return false;
  };
  return {
    room: {
      id: room.id,
      name: room.name,
      type: room.type,
      polygon: room.polygon,
      ceilingHeight: room.ceilingHeight ?? floor.height,
    },
    walls,
    targetWallId: region.wallId !== undefined && faces.has(region.wallId) ? region.wallId : null,
    openings: Object.values(floor.openings)
      .filter((o) => faces.has(o.wallId))
      .map((o) => ({
        id: o.id,
        wallId: o.wallId,
        kind: o.kind,
        offset: o.offset,
        width: o.width,
        height: o.height,
        ...(o.sill === undefined ? {} : { sill: o.sill }),
        ...(o.hinge === undefined ? {} : { hinge: o.hinge }),
        ...(o.swing === undefined ? {} : { swing: o.swing }),
      })),
    devices: Object.values(floor.devices)
      .filter((d) => types.has(deviceTypeKey(d)) && inRoom(d))
      .map((d) => ({ id: d.id, domain: d.domain, type: d.type, placement: d.placement })),
    detectable: [...detectable],
  };
}

/**
 * The earlier photos sent with `photo` for context: other photos of its room, those of the same
 * wall first, then the most recent, at most `MAX_EARLIER`.
 */
export function earlierPhotos(
  photos: readonly Attachment[],
  photo: Pick<Attachment, 'id' | 'region'>,
): Attachment[] {
  const region = photo.region;
  if (!region) return [];
  const sameWall = (p: Attachment) =>
    region.wallId !== undefined && p.region?.wallId === region.wallId ? 0 : 1;
  return photos
    .filter((p) => p.id !== photo.id && p.region?.roomId === region.roomId)
    .sort((p, q) => sameWall(p) - sameWall(q) || q.createdAt.localeCompare(p.createdAt))
    .slice(0, MAX_EARLIER);
}

/**
 * What the floor's pending suggestions mean for a new photo: the devices already suggested, and the
 * openings and rooms with a correction waiting, so nothing is suggested twice.
 */
export function pendingOnFloor(
  suggestions: readonly Suggestion[],
  parse: (suggestion: Suggestion) => unknown,
): Pick<PhotoSuggestOptions, 'pending' | 'pendingCorrections'> {
  const pending: PhotoSuggestOptions['pending'][number][] = [];
  const openingIds: Id[] = [];
  const roomIds: Id[] = [];
  for (const s of suggestions) {
    if (s.status !== 'pending') continue;
    const payload = parse(s);
    if (payload === null) continue;
    if (s.kind === 'device') pending.push(payload as Device);
    else if (s.kind === 'opening') openingIds.push((payload as { id: Id }).id);
    else if (s.kind === 'room-ceiling-height') roomIds.push((payload as { roomId: Id }).roomId);
  }
  return { pending, pendingCorrections: { openingIds, roomIds } };
}
