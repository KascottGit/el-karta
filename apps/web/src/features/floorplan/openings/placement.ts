import {
  doorFacing,
  EPSILON,
  normalize,
  OPENING_DEFAULTS,
  sub,
  wallLength,
  type FloorData,
  type Id,
  type Opening,
  type OpeningKind,
  type OpeningSize,
  type Pt,
  type Wall,
  type WallHit,
} from '@el-karta/core';

const WINDOW_SILL = OPENING_DEFAULTS.window.sill ?? 0.9;

type OpeningsOf = Pick<FloorData, 'walls' | 'openings'>;
type Span = Pick<Opening, 'offset' | 'width'>;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Metres from the wall's end `a` to the projection of `p` onto its centre line, unclamped. */
export function offsetAlong(wall: Wall, p: Pt): number {
  const dir = normalize(sub(wall.b, wall.a));
  const rel = sub(p, wall.a);
  return rel.x * dir.x + rel.y * dir.y;
}

/** The other openings in a wall, leaving out `exceptId`. */
export const openingsOnWall = (floor: OpeningsOf, wallId: Id, exceptId?: Id): Opening[] =>
  Object.values(floor.openings).filter((o) => o.wallId === wallId && o.id !== exceptId);

/**
 * Where an opening of `width` can start on a wall of `length` without overlapping `others`: `desired`
 * if that is free, else the nearest free offset, which nudges it beside a neighbour. Touching a
 * neighbour is fine, as in the validator. Null if the wall is too short or full.
 */
export function fitOffset(
  desired: number,
  width: number,
  length: number,
  others: readonly Span[],
): number | null {
  if (width > length + EPSILON) return null;
  const max = Math.max(0, length - width);
  const blocked = others.map((o) => [o.offset - width, o.offset + o.width] as const);
  const free = (x: number) =>
    x >= -EPSILON &&
    x <= max + EPSILON &&
    blocked.every(([start, end]) => x <= start + EPSILON || x >= end - EPSILON);
  const start = clamp(desired, 0, max);
  if (free(start)) return start;
  let best: number | null = null;
  for (const x of [0, max, ...blocked.flat()]) {
    if (free(x) && (best === null || Math.abs(x - start) < Math.abs(best - start))) best = x;
  }
  return best === null ? null : clamp(best, 0, max);
}

export type Placement =
  { ok: true; opening: Opening } | { ok: false; reason: 'too-short' | 'no-room' };

/**
 * A new opening centred where the wall was hit, clamped to the wall's ends and nudged beside any
 * opening it would overlap.
 */
export function placeOpening(
  floor: OpeningsOf,
  kind: OpeningKind,
  hit: WallHit,
  size: OpeningSize,
  id: Id,
): Placement {
  if (size.width > hit.length + EPSILON) return { ok: false, reason: 'too-short' };
  const offset = fitOffset(
    hit.offset - size.width / 2,
    size.width,
    hit.length,
    openingsOnWall(floor, hit.wallId),
  );
  if (offset === null) return { ok: false, reason: 'no-room' };
  const base: Opening = {
    id,
    wallId: hit.wallId,
    kind,
    offset,
    width: size.width,
    height: size.height,
    provenance: { status: 'manual' },
  };
  if (kind === 'door') return { ok: true, opening: { ...base, ...doorFacing(hit.side) } };
  if (kind === 'window' && size.sill !== undefined)
    return { ok: true, opening: { ...base, sill: size.sill } };
  return { ok: true, opening: base };
}

/**
 * The opening slid along its own wall so that the point grabbed `grab` metres from its near edge
 * follows `p`, clamped to the wall and kept off its neighbours. Null if it fits nowhere on the wall.
 */
export function slideOpening(
  floor: OpeningsOf,
  opening: Opening,
  grab: number,
  p: Pt,
): Opening | null {
  const wall = floor.walls[opening.wallId];
  if (!wall) return null;
  const offset = fitOffset(
    offsetAlong(wall, p) - grab,
    opening.width,
    wallLength(wall),
    openingsOnWall(floor, wall.id, opening.id),
  );
  return offset === null ? null : { ...opening, offset };
}

/**
 * The openings with a new width, each keeping its centre where it can and then clamped and nudged
 * like a new one. Openings on the same wall are fitted one after the other, so they do not overlap
 * each other. Null if any of them no longer fits.
 */
export function resizeOpenings(
  floor: OpeningsOf,
  openings: readonly Opening[],
  width: number,
): Opening[] | null {
  const placed = { ...floor.openings };
  const resized: Opening[] = [];
  for (const opening of openings) {
    const wall = floor.walls[opening.wallId];
    if (!wall) return null;
    const offset = fitOffset(
      opening.offset + (opening.width - width) / 2,
      width,
      wallLength(wall),
      openingsOnWall({ walls: floor.walls, openings: placed }, wall.id, opening.id),
    );
    if (offset === null) return null;
    const next = { ...opening, offset, width };
    placed[next.id] = next;
    resized.push(next);
  }
  return resized;
}

/**
 * The opening as another kind. Windows get a sill and doors a hinge and swing if they have none;
 * other kinds drop them. The height becomes the new kind's default when switching to or from a
 * window, since a door's height makes no sense for a window.
 */
export function withKind(opening: Opening, kind: OpeningKind): Opening {
  if (opening.kind === kind) return opening;
  const { sill, hinge, swing, ...rest } = opening;
  const height =
    kind === 'window' || opening.kind === 'window' ? OPENING_DEFAULTS[kind].height : rest.height;
  const next: Opening = { ...rest, kind, height };
  if (kind === 'window') return { ...next, sill: sill ?? WINDOW_SILL };
  if (kind === 'door') return { ...next, hinge: hinge ?? 'left', swing: swing ?? 'in' };
  return next;
}

export const flipHinge = (opening: Opening): Opening => ({
  ...opening,
  hinge: opening.hinge === 'right' ? 'left' : 'right',
});

export const flipSwing = (opening: Opening): Opening => ({
  ...opening,
  swing: opening.swing === 'out' ? 'in' : 'out',
});
