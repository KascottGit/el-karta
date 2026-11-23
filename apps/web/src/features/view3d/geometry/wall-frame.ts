import { add, EPSILON, normalize, scale, sub, type Opening, type Wall } from '@el-karta/core';
import type { Box } from './types';

/** An opening's cut-out in its wall: metres along the wall from end `a`, and z from the floor. */
export interface Hole {
  start: number;
  end: number;
  bottom: number;
  top: number;
}

/**
 * The opening's cut-out, clamped to a wall of `length` and `height`, or null when nothing of it is
 * left. `offset` is the opening's start, measured from `a` (ADR 0006). The wall's pieces and the
 * opening's own piece both use this, so the piece always fills the hole.
 */
export function openingHole(opening: Opening, length: number, height: number): Hole | null {
  const start = clamp(opening.offset, 0, length);
  const end = clamp(opening.offset + opening.width, 0, length);
  const sill = opening.sill ?? 0;
  const bottom = clamp(sill, 0, height);
  const top = clamp(sill + opening.height, 0, height);
  return end - start > EPSILON && top - bottom > EPSILON ? { start, end, bottom, top } : null;
}

/**
 * A box in a wall's own frame: from `start` to `end` metres along it from `a`, from `bottom` to
 * `top` above the floor, and `thickness` across it, centred on its centre line.
 */
export function boxAlongWall(
  wall: Wall,
  { start, end, bottom, top }: Hole,
  thickness: number,
): Box {
  const dir = normalize(sub(wall.b, wall.a));
  const mid = add(wall.a, scale(dir, (start + end) / 2));
  return {
    center: { x: mid.x, y: mid.y, z: (bottom + top) / 2 },
    size: { x: end - start, y: thickness, z: top - bottom },
    rotation: Math.atan2(dir.y, dir.x),
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
