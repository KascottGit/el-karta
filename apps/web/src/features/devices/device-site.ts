import {
  closestOnSegment,
  distance,
  dot,
  nearestWall,
  normalize,
  pointInPolygon,
  roomAt,
  sub,
  wallFacePoint,
  wallLength,
  type Device,
  type DeviceTypeDef,
  type FloorData,
  type Id,
  type Pt,
  type Room,
  type Wall,
  type WallHit,
} from '@el-karta/core';
import type { DeviceSite } from './new-device';

type SiteFloor = Pick<FloorData, 'walls' | 'rooms'>;

/** Height on the wall for a wall type that has no default height. */
const FALLBACK_WALL_HEIGHT = 1;
/** How far beyond a wall face the room a wall device faces is looked up. */
const ROOM_PROBE = 0.1;

/** The room in front of a wall face at `offset`, if any. */
function roomFacing(floor: SiteFloor, wall: Wall, offset: number, side: 'left' | 'right') {
  const probe = { ...wall, thickness: wall.thickness + 2 * ROOM_PROBE };
  return roomAt(floor, wallFacePoint(probe, offset, side));
}

const onWall = (
  floor: SiteFloor,
  hit: Pick<WallHit, 'wallId' | 'offset' | 'side'>,
  height: number,
  fallbackRoom?: Id,
): DeviceSite | null => {
  const wall = floor.walls[hit.wallId];
  if (!wall) return null;
  const roomId = roomFacing(floor, wall, hit.offset, hit.side) ?? fallbackRoom;
  return {
    placement: { kind: 'wall', wallId: hit.wallId, offset: hit.offset, side: hit.side, height },
    roomId,
  };
};

/**
 * On the face of the nearest wall whose face is within `reach` metres of `at`: on the side `at`
 * is on, at the point along the wall nearest to it. Null away from every wall.
 */
export function wallSite(floor: SiteFloor, at: Pt, reach: number, height: number) {
  const hit = nearestWall(floor, at, reach);
  return hit ? onWall(floor, hit, height) : null;
}

/** On the ceiling of the room `at` stands in; null outside every room. */
export function ceilingSite(floor: SiteFloor, at: Pt): DeviceSite | null {
  const roomId = roomAt(floor, at);
  return roomId === undefined ? null : { placement: { kind: 'ceiling', roomId, at }, roomId };
}

/** On the floor at `at`, in the room it stands in, if any. */
export const floorSite = (floor: SiteFloor, at: Pt): DeviceSite => ({
  placement: { kind: 'floor', at },
  roomId: roomAt(floor, at),
});

/**
 * Where a new device of `def` goes for a pointer at `at`: its placements are tried in order (wall
 * within `reach` metres, ceiling of the room under the pointer, floor), and the first that fits
 * wins. Null when none does.
 */
export function newDeviceSite(
  floor: SiteFloor,
  def: Pick<DeviceTypeDef, 'placements' | 'defaultHeight'>,
  at: Pt,
  reach: number,
): DeviceSite | null {
  for (const kind of def.placements) {
    const site =
      kind === 'wall'
        ? wallSite(floor, at, reach, def.defaultHeight ?? FALLBACK_WALL_HEIGHT)
        : kind === 'ceiling'
          ? ceilingSite(floor, at)
          : kind === 'floor'
            ? floorSite(floor, at)
            : null;
    if (site) return site;
  }
  return null;
}

/** `at` projected onto the wall's centre line, clamped to its ends. */
function alongWall(wall: Wall, at: Pt): number {
  const offset = dot(sub(at, wall.a), normalize(sub(wall.b, wall.a)));
  return Math.min(wallLength(wall), Math.max(0, offset));
}

/** Steps of halving the gap when finding the edge of a room along a drag. */
const EDGE_STEPS = 24;

/**
 * The point in `room` nearest to `at`: `at` itself inside, else the nearest point of its outline,
 * pulled back towards `from` (inside the room) until it is inside. Null if `from` is not inside.
 */
export function insideRoom(room: Pick<Room, 'polygon'>, from: Pt, at: Pt): Pt | null {
  const { polygon } = room;
  if (pointInPolygon(at, polygon)) return at;
  if (!pointInPolygon(from, polygon)) return null;
  let edge = at;
  let best = Infinity;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    const { point } = closestOnSegment(at, a, b);
    const d = distance(point, at);
    if (d < best) {
      best = d;
      edge = point;
    }
  });
  let inside = from;
  let outside = edge;
  for (let i = 0; i < EDGE_STEPS; i++) {
    const mid = { x: (inside.x + outside.x) / 2, y: (inside.y + outside.y) / 2 };
    if (pointInPolygon(mid, polygon)) inside = mid;
    else outside = mid;
  }
  return inside;
}

/**
 * The device with its placement moved for a pointer at `at`, or null when it cannot move there.
 *
 * - On a wall it attaches to the nearest wall face within `reach` metres, which may be another
 *   wall or the other face, keeping its height; away from every wall it slides along its own wall.
 * - On a ceiling it stays in its room, stopping at the room's outline.
 * - On the floor it goes to `at`.
 *
 * It takes the room it then faces or stands in; out of every room it keeps its old one, since
 * `updateDevice` cannot clear an optional field.
 */
export function movedDevice(
  floor: SiteFloor,
  device: Device,
  at: Pt,
  reach: number,
): Device | null {
  const { placement } = device;
  let site: DeviceSite | null = null;
  switch (placement.kind) {
    case 'wall': {
      const own = floor.walls[placement.wallId];
      const hit =
        nearestWall(floor, at, reach) ??
        (own && { wallId: own.id, offset: alongWall(own, at), side: placement.side });
      site = hit ? onWall(floor, hit, placement.height, device.roomId) : null;
      break;
    }
    case 'ceiling': {
      const room = floor.rooms[placement.roomId];
      const inside = room && insideRoom(room, placement.at, at);
      site = inside ? { placement: { ...placement, at: inside }, roomId: placement.roomId } : null;
      break;
    }
    case 'floor':
      site = { placement: { ...placement, at }, roomId: roomAt(floor, at) ?? device.roomId };
      break;
    case 'container':
      return null;
  }
  if (!site) return null;
  const { roomId, placement: next } = site;
  return { ...device, ...(roomId === undefined ? {} : { roomId }), placement: next };
}

/** Where a device's placement puts its marker or centre on the plan, for grabbing it. */
export function siteAnchor(floor: SiteFloor, device: Device): Pt | null {
  const { placement } = device;
  if (placement.kind === 'wall') {
    const wall = floor.walls[placement.wallId];
    return wall ? wallFacePoint(wall, placement.offset, placement.side) : null;
  }
  return placement.kind === 'container' ? null : placement.at;
}
