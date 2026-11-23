import { EPSILON, wallLength, type FloorData, type Opening, type Wall } from '@el-karta/core';
import { fitOffset, openingsOnWall } from './placement';

/** The narrowest an opening can be made by dragging its edge. */
export const MIN_OPENING_WIDTH = 0.1;
/** The lowest an opening can be made by dragging its top or a window's sill. */
export const MIN_OPENING_HEIGHT = 0.1;

/**
 * What an opening is moved and resized within: its wall, the other openings in that wall and the
 * floor's height, which is the wall's height when the wall has none of its own.
 */
export interface OpeningFrame {
  wall: Wall;
  others: readonly Pick<Opening, 'offset' | 'width'>[];
  floorHeight: number;
}

/**
 * An opening's edges along its wall: `start` is the edge at `offset` (nearer the wall's end `a`),
 * `end` the one at `offset + width`.
 */
export type OpeningEdge = 'start' | 'end';

/** The frame of an opening on a floor, or null if its wall is missing. */
export function openingFrame(
  floor: Pick<FloorData, 'walls' | 'openings' | 'height'>,
  opening: Opening,
): OpeningFrame | null {
  const wall = floor.walls[opening.wallId];
  if (!wall) return null;
  return { wall, others: openingsOnWall(floor, wall.id, opening.id), floorHeight: floor.height };
}

/** Rounds to whole centimetres, which is what snapping does to dragged sizes and positions. */
export const toCentimetres = (v: number) => Math.round(v * 100) / 100;

const wallHeight = (frame: OpeningFrame) => frame.wall.height ?? frame.floorHeight;

/**
 * The opening slid along its wall to start at `offset`, clamped to the wall and nudged beside its
 * neighbours (`fitOffset`). With `round`, the offset is first rounded to whole centimetres. Null if
 * it fits nowhere on the wall.
 */
export function slideOpeningTo(
  frame: OpeningFrame,
  opening: Opening,
  offset: number,
  round = false,
): Opening | null {
  const fitted = fitOffset(
    round ? toCentimetres(offset) : offset,
    opening.width,
    wallLength(frame.wall),
    frame.others,
  );
  return fitted === null ? null : { ...opening, offset: fitted };
}

/**
 * How far along the wall the opening's edges can reach: from the wall's start or the end of the
 * nearest opening before it, to the wall's end or the start of the nearest opening after it.
 */
function room(frame: OpeningFrame, opening: Opening) {
  const centre = opening.offset + opening.width / 2;
  let min = 0;
  let max = wallLength(frame.wall);
  for (const o of frame.others) {
    if (o.offset + o.width / 2 < centre) min = Math.max(min, o.offset + o.width);
    else max = Math.min(max, o.offset);
  }
  return { min, max };
}

/**
 * The opening with one edge moved to `at` metres from the wall's end `a`, the other edge staying
 * where it is. The width is clamped to at least `MIN_OPENING_WIDTH` and to the wall's ends and the
 * neighbouring openings; with `round` it is rounded to whole centimetres before clamping. Null if
 * there is no room for the minimum width.
 */
export function moveOpeningEdge(
  frame: OpeningFrame,
  opening: Opening,
  edge: OpeningEdge,
  at: number,
  round = false,
): Opening | null {
  const { min, max } = room(frame, opening);
  const start = opening.offset;
  const end = opening.offset + opening.width;
  const fixed = edge === 'start' ? end : start;
  const limit = edge === 'start' ? fixed - min : max - fixed;
  if (limit < MIN_OPENING_WIDTH - EPSILON) return null;
  const wanted = edge === 'start' ? fixed - at : at - fixed;
  const width = Math.min(
    limit,
    Math.max(MIN_OPENING_WIDTH, round ? toCentimetres(wanted) : wanted),
  );
  return edge === 'start' ? { ...opening, offset: fixed - width, width } : { ...opening, width };
}

/**
 * The opening with its top moved to `top` metres above the floor, keeping a window's sill: the
 * height is clamped to at least `MIN_OPENING_HEIGHT` and to the wall's height; with `round` it is
 * rounded to whole centimetres before clamping. Null if a window's sill leaves no room below the
 * top of the wall.
 */
export function setOpeningTop(
  frame: OpeningFrame,
  opening: Opening,
  top: number,
  round = false,
): Opening | null {
  const bottom = opening.kind === 'window' ? (opening.sill ?? 0) : 0;
  const limit = wallHeight(frame) - bottom;
  if (limit < MIN_OPENING_HEIGHT - EPSILON) return null;
  const wanted = top - bottom;
  const height = Math.min(
    limit,
    Math.max(MIN_OPENING_HEIGHT, round ? toCentimetres(wanted) : wanted),
  );
  return { ...opening, height };
}

/**
 * A window with its sill moved to `sill` metres above the floor, keeping its top: the sill is clamped
 * to the floor and to leave at least `MIN_OPENING_HEIGHT`; with `round` it is rounded to whole
 * centimetres before clamping. Null for doors and passages, which have no sill, and for a window
 * too low to have room for one.
 */
export function setOpeningSill(
  _frame: OpeningFrame,
  opening: Opening,
  sill: number,
  round = false,
): Opening | null {
  if (opening.kind !== 'window') return null;
  const top = (opening.sill ?? 0) + opening.height;
  const limit = top - MIN_OPENING_HEIGHT;
  if (limit < -EPSILON) return null;
  const next = Math.min(Math.max(0, limit), Math.max(0, round ? toCentimetres(sill) : sill));
  return { ...opening, sill: next, height: top - next };
}
