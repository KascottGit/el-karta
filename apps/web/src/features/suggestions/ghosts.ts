import { worstSeverity } from '@/features/floorplan/validation/severity';
import {
  closestOnSegment,
  distance,
  pointInPolygon,
  type Id,
  type IssueSeverity,
  type Pt,
  type Suggestion,
  type SuggestionKinds,
} from '@el-karta/core';
import { boundsOf, type Rect } from '@/features/floorplan/canvas/rect';
import { suggestionView, type GhostShape, type WallLike } from './views';

/** A pending suggestion as drawn on the canvas. */
export interface Ghost {
  suggestion: Suggestion;
  shape: GhostShape;
  /** The worst severity among the suggestion's issues. */
  severity: IssueSeverity | null;
}

/** Parses a payload with its kind's schema; null when the kind is unknown or the payload does not fit. */
export function parsePayload(kinds: SuggestionKinds, suggestion: Suggestion): unknown {
  const def = kinds.get(suggestion.kind);
  if (!def) return null;
  try {
    return def.parse(suggestion.payload);
  } catch {
    return null;
  }
}

/** A built ghost and the wall it was placed on, if it looked one up. */
type Built = { ghost: Ghost | null; on: { id: Id; wall: WallLike | undefined } | null };

/**
 * Returns a function from a floor's suggestions and walls to the ghosts of its pending
 * suggestions, keyed by suggestion id. Openings are placed on the floor's wall or the suggested
 * wall their payload names. Ghosts are reused while their suggestion (and, for an opening, its
 * wall) is the same object, and so is the whole record while nothing changed, so an edit
 * elsewhere on the floor neither re-measures nor redraws them.
 */
export function createGhostBuilder(kinds: SuggestionKinds) {
  const parsed = new WeakMap<Suggestion, unknown>();
  const built = new WeakMap<Suggestion, Built>();
  let last: Readonly<Record<Id, Ghost>> = {};

  const payloadOf = (s: Suggestion) => {
    if (!parsed.has(s)) parsed.set(s, parsePayload(kinds, s));
    return parsed.get(s);
  };

  return (
    suggestions: readonly Suggestion[],
    floorWalls: Readonly<Record<Id, WallLike>>,
  ): Readonly<Record<Id, Ghost>> => {
    const pending = suggestions.filter((s) => s.status === 'pending' && payloadOf(s) !== null);
    const walls = new Map<Id, WallLike>(Object.entries(floorWalls));
    for (const s of pending) {
      if (s.kind !== 'wall') continue;
      const wall = payloadOf(s) as WallLike & { id: Id };
      if (!walls.has(wall.id)) walls.set(wall.id, wall);
    }

    const ghosts: Record<Id, Ghost> = {};
    let changed = false;
    for (const s of pending) {
      const cached = built.get(s);
      let ghost: Ghost | null;
      if (cached && (!cached.on || walls.get(cached.on.id) === cached.on.wall)) {
        ghost = cached.ghost;
      } else {
        let on: Built['on'] = null;
        const lookup = (id: Id) => {
          const wall = walls.get(id);
          on = { id, wall };
          return wall;
        };
        const shape = suggestionView(s.kind).ghost?.(payloadOf(s), lookup) ?? null;
        ghost = shape && { suggestion: s, shape, severity: worstSeverity(s.issues) };
        built.set(s, { ghost, on });
      }
      if (!ghost) continue;
      ghosts[s.id] = ghost;
      if (last[s.id] !== ghost) changed = true;
    }
    if (!changed && Object.keys(ghosts).length === Object.keys(last).length) return last;
    last = ghosts;
    return ghosts;
  };
}

export function ghostBounds({ shape }: Ghost): Rect | null {
  switch (shape.type) {
    case 'line':
      return boundsOf([shape.a, shape.b], shape.thickness / 2);
    case 'area':
      return boundsOf(shape.polygon);
  }
}

/** Distance from `p` to the ghost's outline, or 0 inside an area. */
function reach(shape: GhostShape, p: Pt): number {
  if (shape.type === 'area') {
    if (pointInPolygon(p, shape.polygon)) return 0;
    let best = Infinity;
    shape.polygon.forEach((a, i) => {
      const b = shape.polygon[(i + 1) % shape.polygon.length]!;
      best = Math.min(best, distance(p, closestOnSegment(p, a, b).point));
    });
    return best;
  }
  return Math.max(
    0,
    distance(p, closestOnSegment(p, shape.a, shape.b).point) - shape.thickness / 2,
  );
}

/** Smaller things win, so an opening can be tapped on its wall and a wall inside its room. */
const PRIORITY: Readonly<Record<GhostShape['role'], number>> = { opening: 0, wall: 1, area: 2 };

/** The ghost under a point, within `tolerance` metres: openings before walls before areas, then the nearest. */
export function ghostAt(ghosts: Iterable<Ghost>, p: Pt, tolerance: number): Ghost | null {
  let best: { ghost: Ghost; rank: number; d: number } | null = null;
  for (const ghost of ghosts) {
    const d = reach(ghost.shape, p);
    if (d > tolerance) continue;
    const rank = PRIORITY[ghost.shape.role];
    if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { ghost, rank, d };
  }
  return best?.ghost ?? null;
}
