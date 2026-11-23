import { polygonProblem, type FloorData } from '@el-karta/core';
import type { RoomSlab } from './types';

/**
 * A slab per room, along the room's polygon (wall centrelines, ADR 0006). Rooms whose polygon is
 * invalid are left out; the 2D editor shows their issue.
 */
export const roomSlabs = (floor: FloorData): RoomSlab[] =>
  Object.values(floor.rooms)
    .filter((room) => polygonProblem(room.polygon) === null)
    .map((room) => ({ roomId: room.id, outline: room.polygon }));
