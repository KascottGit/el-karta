import {
  centroid,
  distance,
  dot,
  imageToWorld,
  normalize,
  Opening,
  Room,
  sub,
  Wall,
  worldToImage,
  type BackgroundPlacement,
  type Id,
  type Pt,
  type Suggestion,
  type SuggestionDraft,
} from '@el-karta/core';
import { z } from 'zod';

/** Ends of a wall, and centres of a room, closer than this in metres are the same item. */
export const SAME_ITEM_METRES = 0.15;

/** A suggestion accepted earlier, with the background placement it was measured at. */
export interface AcceptedItem {
  suggestion: Suggestion;
  placement: BackgroundPlacement;
}

// Ids are only passed on, so any string will do.
const WallPayload = Wall.pick({ a: true, b: true }).extend({ id: z.string() });
const OpeningPayload = Opening.omit({ provenance: true }).extend({
  id: z.string(),
  wallId: z.string(),
});
const RoomPayload = Room.pick({ name: true, polygon: true });

interface Segment {
  a: Pt;
  b: Pt;
}

const sameWall = (p: Segment, q: Segment, tolerance: number) =>
  (distance(p.a, q.a) <= tolerance && distance(p.b, q.b) <= tolerance) ||
  (distance(p.a, q.b) <= tolerance && distance(p.b, q.a) <= tolerance);

/**
 * An opening placed on the new wall `from`, moved onto the accepted wall `to` (where it lies on
 * the image now): the same span along it, and hinge and swing flipped when `to` runs the other
 * way, since both are relative to the wall's direction (ADR 0006).
 */
function onWall(opening: Omit<Opening, 'provenance'>, from: Segment, to: Segment & { id: Id }) {
  const along = normalize(sub(from.b, from.a));
  const middle = opening.offset + opening.width / 2;
  const centre = { x: from.a.x + along.x * middle, y: from.a.y + along.y * middle };
  const direction = normalize(sub(to.b, to.a));
  const length = distance(to.a, to.b);
  const offset = Math.min(
    Math.max(0, dot(sub(centre, to.a), direction) - opening.width / 2),
    Math.max(0, length - opening.width),
  );
  const reversed = dot(along, direction) < 0;
  return {
    ...opening,
    wallId: to.id,
    offset,
    ...(reversed && opening.kind === 'door'
      ? {
          hinge: opening.hinge === 'right' ? ('left' as const) : ('right' as const),
          swing: opening.swing === 'out' ? ('in' as const) : ('out' as const),
        }
      : {}),
  };
}

/**
 * Leaves out new drafts that repeat a suggestion already accepted from an earlier reading of the
 * same image: walls with the same ends and rooms with the same name and centre. Openings on a
 * repeated wall move onto the accepted wall and require its suggestion instead; anything else
 * that requires a repeated draft is left out too. Accepted items are compared where they lie on
 * the image at the new placement `to`, each moved from the placement it was measured at, so it
 * does not matter whether the person also rescaled what is drawn.
 */
export function withoutAccepted(
  drafts: readonly SuggestionDraft[],
  accepted: readonly AcceptedItem[],
  to: BackgroundPlacement,
  tolerance = SAME_ITEM_METRES,
): SuggestionDraft[] {
  const walls: (Segment & { id: Id; suggestionId: Id })[] = [];
  const rooms: { name: string; centre: Pt }[] = [];
  for (const { suggestion, placement } of accepted) {
    const moved = (p: Pt) => imageToWorld(to, worldToImage(placement, p));
    if (suggestion.kind === 'wall') {
      const wall = WallPayload.safeParse(suggestion.payload);
      if (wall.success)
        walls.push({
          id: wall.data.id,
          suggestionId: suggestion.id,
          a: moved(wall.data.a),
          b: moved(wall.data.b),
        });
    } else if (suggestion.kind === 'room') {
      const room = RoomPayload.safeParse(suggestion.payload);
      if (room.success)
        rooms.push({ name: room.data.name, centre: moved(centroid(room.data.polygon)) });
    }
  }

  const dropped = new Set<Id>();
  /** Repeated wall drafts: the new wall and the accepted wall it repeats. */
  const repeats = new Map<Id, { draft: Segment; accepted: (typeof walls)[number] }>();
  for (const draft of drafts) {
    if (draft.kind === 'wall') {
      const wall = WallPayload.safeParse(draft.payload);
      const match = wall.success ? walls.find((w) => sameWall(w, wall.data, tolerance)) : null;
      if (wall.success && match) {
        dropped.add(draft.id);
        repeats.set(draft.id, { draft: wall.data, accepted: match });
      }
    } else if (draft.kind === 'room') {
      const room = RoomPayload.safeParse(draft.payload);
      if (!room.success) continue;
      const centre = centroid(room.data.polygon);
      if (rooms.some((r) => r.name === room.data.name && distance(r.centre, centre) <= tolerance))
        dropped.add(draft.id);
    }
  }

  const kept = drafts.map((draft): SuggestionDraft => {
    const wallDraft = draft.kind === 'opening' ? draft.requires.find((r) => repeats.has(r)) : null;
    const opening = wallDraft ? OpeningPayload.safeParse(draft.payload) : null;
    if (!wallDraft || !opening?.success) return draft;
    const { draft: from, accepted: to } = repeats.get(wallDraft)!;
    return {
      ...draft,
      payload: onWall(opening.data, from, to),
      requires: draft.requires.map((r) => (r === wallDraft ? to.suggestionId : r)),
    };
  });
  for (let grew = true; grew;) {
    grew = false;
    for (const draft of kept) {
      if (!dropped.has(draft.id) && draft.requires.some((r) => dropped.has(r))) {
        dropped.add(draft.id);
        grew = true;
      }
    }
  }
  return kept.filter((d) => !dropped.has(d.id));
}
