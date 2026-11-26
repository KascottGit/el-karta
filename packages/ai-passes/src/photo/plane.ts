import { distance, dot, normalize, sub, type Pt } from '@el-karta/core';
import { wallIndex, openingIndex } from './refs.ts';
import type { ImageCorner, PhotoInput, PhotoReference, PhotoWall } from './schema.ts';

/**
 * A wall as the photo sees it. Wall-plane coordinates are `u`, metres along the wall's centre line
 * from `a` (as `WallPlacement.offset` and `Opening.offset`), and `v`, metres above the floor.
 */
export interface WallFrame {
  length: number;
  /** The `u` range of the face visible in the room (the room polygon's extent along the wall). */
  start: number;
  end: number;
  /**
   * The wall end on the left of the photo. The viewer stands in the room facing the wall's `side`
   * face: from the `right` side (room right of a→b) `a` is on the left, from the `left` side `b`.
   */
  leftEnd: 'a' | 'b';
}

/** How far from the wall's centre line a room polygon vertex may lie and still mark its face end. */
const FACE_REACH = 0.05;

export function wallFrame(wall: PhotoWall, polygon: readonly Pt[]): WallFrame {
  const length = distance(wall.a, wall.b);
  const dir = normalize(sub(wall.b, wall.a));
  const along: number[] = [];
  for (const p of polygon) {
    const rel = sub(p, wall.a);
    const u = dot(rel, dir);
    const off = Math.abs(rel.x * dir.y - rel.y * dir.x);
    if (
      off <= wall.thickness / 2 + FACE_REACH &&
      u >= -wall.thickness &&
      u <= length + wall.thickness
    )
      along.push(Math.min(length, Math.max(0, u)));
  }
  const start = along.length >= 2 ? Math.min(...along) : 0;
  const end = along.length >= 2 ? Math.max(...along) : length;
  return {
    length,
    ...(end - start > 0 ? { start, end } : { start: 0, end: length }),
    leftEnd: wall.side === 'right' ? 'a' : 'b',
  };
}

/** `u` of the image-left or image-right end of a span `from`–`to` (`from` < `to`) along the wall. */
export const spanEnd = (
  frame: WallFrame,
  horizontal: 'left' | 'right',
  from: number,
  to: number,
) => ((horizontal === 'left') === (frame.leftEnd === 'a') ? from : to);

const split = (corner: ImageCorner) => {
  const [vertical, horizontal] = corner.split('_') as ['top' | 'bottom', 'left' | 'right'];
  return { vertical, horizontal };
};

/** Where a reference is on its wall's plane. */
export interface PlaneRef {
  wall: number;
  u: number;
  /** Null when the height is unknown (a window without a sill). */
  v: number | null;
  /** A wall corner at the ceiling: its height is the room's ceiling height only as far as we know. */
  ceiling: boolean;
  /** The opening index for an opening corner. */
  opening: number | null;
  corner: ImageCorner;
}

/** The plane position of a reference, or null when it names nothing in the input. */
export function planeRef(
  ref: PhotoReference,
  input: Pick<PhotoInput, 'walls' | 'openings' | 'room'>,
  frames: readonly WallFrame[],
): PlaneRef | null {
  const { vertical, horizontal } = split(ref.corner);
  if (ref.what === 'wall_corner') {
    const wall = wallIndex(ref.ref, input.walls.length);
    const frame = wall === null ? undefined : frames[wall];
    if (wall === null || !frame) return null;
    const top = vertical === 'top';
    return {
      wall,
      u: spanEnd(frame, horizontal, frame.start, frame.end),
      v: top ? input.room.ceilingHeight : 0,
      ceiling: top,
      opening: null,
      corner: ref.corner,
    };
  }
  const index = openingIndex(ref.ref, input.openings.length);
  const opening = index === null ? undefined : input.openings[index];
  const wall = opening ? input.walls.findIndex((w) => w.id === opening.wallId) : -1;
  const frame = frames[wall];
  if (index === null || !opening || !frame) return null;
  const sill = opening.sill ?? (opening.kind === 'window' ? null : 0);
  return {
    wall,
    u: spanEnd(frame, horizontal, opening.offset, opening.offset + opening.width),
    v: sill === null ? null : vertical === 'top' ? sill + opening.height : sill,
    ceiling: false,
    opening: index,
    corner: ref.corner,
  };
}
