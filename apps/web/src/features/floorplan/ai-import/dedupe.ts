import {
  centroid,
  distance,
  imageToWorld,
  Room,
  Wall,
  worldToImage,
  type BackgroundPlacement,
  type Id,
  type Pt,
  type Suggestion,
  type SuggestionDraft,
} from '@el-karta/core';

/** Ends of a wall, and centres of a room, closer than this in metres are the same item. */
export const SAME_ITEM_METRES = 0.15;

const WallPayload = Wall.pick({ a: true, b: true });
const RoomPayload = Room.pick({ name: true, polygon: true });

const sameWall = (p: { a: Pt; b: Pt }, q: { a: Pt; b: Pt }, tolerance: number) =>
  (distance(p.a, q.a) <= tolerance && distance(p.b, q.b) <= tolerance) ||
  (distance(p.a, q.b) <= tolerance && distance(p.b, q.a) <= tolerance);

/**
 * Drops new drafts that repeat a suggestion already accepted from the same reading: walls with the
 * same ends, rooms with the same name and centre, and anything that requires a dropped draft (the
 * openings of a repeated wall). Accepted items are compared where they would lie on the image
 * now: moved from the placement they were measured at (`from`) to the new one (`to`), so it does
 * not matter whether the person also rescaled what is drawn.
 */
export function withoutAccepted(
  drafts: readonly SuggestionDraft[],
  accepted: readonly Suggestion[],
  from: BackgroundPlacement,
  to: BackgroundPlacement,
  tolerance = SAME_ITEM_METRES,
): SuggestionDraft[] {
  const moved = (p: Pt) => imageToWorld(to, worldToImage(from, p));
  const walls = accepted.flatMap((s) => {
    const wall = s.kind === 'wall' ? WallPayload.safeParse(s.payload) : null;
    return wall?.success ? [{ a: moved(wall.data.a), b: moved(wall.data.b) }] : [];
  });
  const rooms = accepted.flatMap((s) => {
    const room = s.kind === 'room' ? RoomPayload.safeParse(s.payload) : null;
    return room?.success
      ? [{ name: room.data.name, centre: moved(centroid(room.data.polygon)) }]
      : [];
  });

  const dropped = new Set<Id>();
  for (const draft of drafts) {
    if (draft.kind === 'wall') {
      const wall = WallPayload.safeParse(draft.payload);
      if (wall.success && walls.some((w) => sameWall(w, wall.data, tolerance)))
        dropped.add(draft.id);
    } else if (draft.kind === 'room') {
      const room = RoomPayload.safeParse(draft.payload);
      if (!room.success) continue;
      const centre = centroid(room.data.polygon);
      if (rooms.some((r) => r.name === room.data.name && distance(r.centre, centre) <= tolerance))
        dropped.add(draft.id);
    }
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const draft of drafts) {
      if (!dropped.has(draft.id) && draft.requires.some((r) => dropped.has(r))) {
        dropped.add(draft.id);
        grew = true;
      }
    }
  }
  return drafts.filter((d) => !dropped.has(d.id));
}
