import type { FloorData, Id, Pt } from '../schemas/index.ts';
import { wallFacePoint, wallLength } from './placement.ts';
import { pointInPolygon, polygonProblem, signedArea } from './polygon.ts';

/** The room a point stands in; the smallest one where rooms overlap. Rooms with a broken outline are skipped. */
export function roomAt(floor: Pick<FloorData, 'rooms'>, at: Pt): Id | undefined {
  let best: { id: Id; area: number } | undefined;
  for (const room of Object.values(floor.rooms)) {
    if (polygonProblem(room.polygon) !== null || !pointInPolygon(at, room.polygon)) continue;
    const area = Math.abs(signedArea(room.polygon));
    if (!best || area < best.area) best = { id: room.id, area };
  }
  return best?.id;
}

export interface RoomBesideWall {
  roomId: Id;
  /** The face of the wall (`WallPlacement.side`) that faces into the room. */
  side: 'left' | 'right';
}

/** How far beyond a wall face the probe points sit, so rooms drawn on centrelines or faces both count. */
const PROBE_GAP = 0.1;
/** Probe spacing along the wall, so a long corridor wall finds every room along it. */
const PROBE_STEP = 0.5;

/**
 * The rooms a wall borders, in order along the wall from `a` (left face first at each point): one
 * for an outer wall, two or more for a wall between rooms. Found by probing just off each face
 * along the wall, keeping clear of its ends where it meets the walls joined to it.
 */
export function roomsBesideWall(
  floor: Pick<FloorData, 'walls' | 'rooms'>,
  wallId: Id,
): RoomBesideWall[] {
  const wall = floor.walls[wallId];
  if (!wall) return [];
  const length = wallLength(wall);
  const margin = Math.min(0.05, length / 4);
  const steps = Math.max(1, Math.ceil((length - 2 * margin) / PROBE_STEP));
  const probe = { ...wall, thickness: wall.thickness + 2 * PROBE_GAP };
  const found: RoomBesideWall[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= steps; i++) {
    const offset = margin + ((length - 2 * margin) * i) / steps;
    for (const side of ['left', 'right'] as const) {
      const roomId = roomAt(floor, wallFacePoint(probe, offset, side));
      const key = `${roomId}:${side}`;
      if (roomId === undefined || seen.has(key)) continue;
      seen.add(key);
      found.push({ roomId, side });
    }
  }
  return found;
}
