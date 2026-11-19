import {
  distance,
  insertVertex,
  moveVertex,
  polygonProblem,
  putSpaceItem,
  removeVertex,
  samePolygon,
  type FloorData,
  type Id,
  type PolygonProblem,
  type Pt,
  type Room,
  type Zone,
} from '@el-karta/core';
import i18n from '@/i18n';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import type { MessageKey } from '../canvas/extension';

export type AreaCollection = 'rooms' | 'zones';
export const AREA_COLLECTIONS: readonly AreaCollection[] = ['rooms', 'zones'];

const issueKind = { rooms: 'room', zones: 'zone' } as const;

/** The validator's message for a polygon problem (`issues.room.polygon-…`). */
export const polygonMessage = (collection: AreaCollection, problem: PolygonProblem): MessageKey =>
  `issues.${issueKind[collection]}.polygon-${problem}`;

/** A vertex being moved, or a new vertex being dragged out of the side after vertex `index`. */
export interface Reshape {
  kind: 'move' | 'insert';
  index: number;
}

/**
 * The polygon after a vertex or midpoint drag to `to`. Dropping a vertex within `mergeTolerance` of
 * a neighbour removes it; that gives null when only three vertices are left.
 */
export function reshapePolygon(
  polygon: readonly Pt[],
  { kind, index }: Reshape,
  to: Pt,
  mergeTolerance: number,
): Pt[] | null {
  if (kind === 'insert') return insertVertex(polygon, index, to);
  const n = polygon.length;
  const neighbours = [polygon[(index - 1 + n) % n]!, polygon[(index + 1) % n]!];
  if (neighbours.some((q) => distance(q, to) <= mergeTolerance))
    return removeVertex(polygon, index);
  return moveVertex(polygon, index, to);
}

export type PolygonCheck = { ok: true; polygon: Pt[] } | { ok: false; problem: PolygonProblem };

export function checkPolygon(polygon: readonly Pt[] | null): PolygonCheck {
  if (!polygon) return { ok: false, problem: 'too-few-points' };
  const problem = polygonProblem(polygon);
  return problem ? { ok: false, problem } : { ok: true, polygon: [...polygon] };
}

const floorData = (floorId: Id): FloorData | undefined =>
  modelStore.getState().model?.floors[floorId]?.data;

export function areaOf(floorId: Id, collection: AreaCollection, id: Id): Room | Zone | undefined {
  return floorData(floorId)?.[collection][id];
}

function put(floorId: Id, collection: AreaCollection, item: Room | Zone) {
  const edit =
    collection === 'rooms'
      ? putSpaceItem(floorId, 'rooms', item as Room)
      : putSpaceItem(floorId, 'zones', item);
  modelStore.getState().apply(edit);
}

/**
 * Adds a room or zone with a numbered name and selects it. A room with the same outline is selected
 * instead of being added twice. The polygon must already be valid.
 */
export function addArea(floorId: Id, collection: AreaCollection, polygon: Pt[]): Id | null {
  const data = floorData(floorId);
  if (!data) return null;
  const existing = Object.values(data[collection]).find((a) => samePolygon(a.polygon, polygon));
  if (existing) {
    editorStore.getState().select([{ collection, id: existing.id }]);
    return existing.id;
  }
  const id = crypto.randomUUID();
  const number = Object.keys(data[collection]).length + 1;
  const base = { id, polygon, provenance: { status: 'manual' as const } };
  const item: Room | Zone =
    collection === 'rooms'
      ? { ...base, name: i18n.t('areas.newRoom', { number }), type: 'other' }
      : { ...base, name: i18n.t('areas.newZone', { number }) };
  put(floorId, collection, item);
  editorStore.getState().select([{ collection, id }]);
  return id;
}

/** Replaces the item whole (ADR 0002) if `change` returns something different. */
export function updateArea<T extends Room | Zone>(
  floorId: Id,
  collection: AreaCollection,
  id: Id,
  change: (item: T) => T,
) {
  const item = areaOf(floorId, collection, id) as T | undefined;
  if (!item) return;
  const next = change(item);
  if (next !== item) put(floorId, collection, next);
}

/** The room with the given ceiling height, or none to use the floor's. */
export function withCeilingHeight(room: Room, height: number | undefined): Room {
  if (height === room.ceilingHeight) return room;
  if (height !== undefined) return { ...room, ceilingHeight: height };
  const next = { ...room };
  delete next.ceilingHeight;
  return next;
}
