import type { Device, FloorData, Pt, Vec3, Wall } from '../schemas/index.ts';
import { add, distance, EPSILON, leftNormal, normalize, scale, sub } from './vec.ts';

export type PlacementProblem =
  | { code: 'wall-missing'; wallId: string }
  | { code: 'offset-beyond-wall'; wallId: string; offset: number; wallLength: number }
  | { code: 'room-missing'; roomId: string }
  | { code: 'parent-missing'; parentId: string }
  | { code: 'container-cycle' };

export type PlacementResult =
  | { ok: true; position: Vec3 }
  /** `approximate` is where to draw the item while it is flagged, when one can be derived. */
  | { ok: false; problem: PlacementProblem; approximate?: Vec3 };

export const wallLength = (wall: Wall): number => distance(wall.a, wall.b);

export function pointOnWall(wall: Wall, offset: number): Pt {
  return add(wall.a, scale(normalize(sub(wall.b, wall.a)), offset));
}

/** Metres from the wall's end `a` to the projection of `p` onto its centre line, unclamped. */
export function offsetAlong(wall: Wall, p: Pt): number {
  const dir = normalize(sub(wall.b, wall.a));
  const rel = sub(p, wall.a);
  return rel.x * dir.x + rel.y * dir.y;
}

export function wallFacePoint(wall: Wall, offset: number, side: 'left' | 'right'): Pt {
  const normal = leftNormal(sub(wall.b, wall.a));
  const toFace = (wall.thickness / 2) * (side === 'left' ? 1 : -1);
  return add(pointOnWall(wall, offset), scale(normal, toFace));
}

export function resolvePlacement(floor: FloorData, device: Device): PlacementResult {
  return resolve(floor, device, new Set());
}

function resolve(floor: FloorData, device: Device, visiting: Set<string>): PlacementResult {
  const { placement } = device;
  switch (placement.kind) {
    case 'wall': {
      const wall = floor.walls[placement.wallId];
      if (!wall) return { ok: false, problem: { code: 'wall-missing', wallId: placement.wallId } };
      const length = wallLength(wall);
      const z = floor.elevation + placement.height;
      if (placement.offset > length + EPSILON) {
        const end = wallFacePoint(wall, length, placement.side);
        return {
          ok: false,
          problem: {
            code: 'offset-beyond-wall',
            wallId: wall.id,
            offset: placement.offset,
            wallLength: length,
          },
          approximate: { ...end, z },
        };
      }
      return {
        ok: true,
        position: { ...wallFacePoint(wall, placement.offset, placement.side), z },
      };
    }
    case 'ceiling': {
      const room = floor.rooms[placement.roomId];
      if (!room) return { ok: false, problem: { code: 'room-missing', roomId: placement.roomId } };
      const z = floor.elevation + (room.ceilingHeight ?? floor.height);
      return { ok: true, position: { ...placement.at, z } };
    }
    case 'floor':
      return { ok: true, position: { ...placement.at, z: floor.elevation } };
    case 'container': {
      if (visiting.has(device.id)) return { ok: false, problem: { code: 'container-cycle' } };
      const parent = floor.devices[placement.parentId];
      if (!parent)
        return { ok: false, problem: { code: 'parent-missing', parentId: placement.parentId } };
      visiting.add(device.id);
      return resolve(floor, parent, visiting);
    }
  }
}
