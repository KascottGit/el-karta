import { EPSILON, wallLength, type FloorData, type Opening } from '@el-karta/core';
import type { OpeningPiece } from './types';
import { boxAlongWall, openingHole } from './wall-frame';

/**
 * How thick each kind's piece is, in metres, at most the wall's thickness. A passage's volume is
 * as thick as the wall so a tap anywhere in the gap picks it.
 */
const THICKNESS: Readonly<Record<Opening['kind'], number | null>> = {
  door: 0.04,
  window: 0.02,
  passage: null,
};

/**
 * One piece per opening filling its cut-out, with the same clamping to the wall as the cut-out
 * itself. Openings on a missing or zero-length wall, or clamped to nothing, have no piece.
 */
export function openingPieces(floor: FloorData): OpeningPiece[] {
  const pieces: OpeningPiece[] = [];
  for (const opening of Object.values(floor.openings)) {
    const wall = floor.walls[opening.wallId];
    if (!wall) continue;
    const length = wallLength(wall);
    if (length < EPSILON) continue;
    const hole = openingHole(opening, length, wall.height ?? floor.height);
    if (!hole) continue;
    const thickness = Math.min(THICKNESS[opening.kind] ?? wall.thickness, wall.thickness);
    pieces.push({
      openingId: opening.id,
      kind: opening.kind,
      ...boxAlongWall(wall, hole, thickness),
    });
  }
  return pieces;
}
