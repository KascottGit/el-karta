import { z } from 'zod';
import {
  addDevice,
  combine,
  EditError,
  putSpaceItem,
  setScale,
  type Edit,
} from '../edits/index.ts';
import { Device } from '../schemas/device.ts';
import { FloorData } from '../schemas/documents.ts';
import { Id, type Provenance } from '../schemas/primitives.ts';
import { Opening, Room, Wall, Zone } from '../schemas/space.ts';
import type { Suggestion } from './suggestion.ts';

/**
 * What a suggestion kind needs to become model data. New kinds (devices, connections) are added by
 * registering a definition, never by changing `acceptSuggestions`.
 */
export interface SuggestionKindDef {
  readonly kind: string;
  /** Validates and narrows a stored payload; throws a ZodError when it does not fit. */
  parse(payload: unknown): unknown;
  /** The model id the accepted item gets, so views can select it; null for floor-level values. */
  itemId(payload: unknown): Id | null;
  accept(floorId: Id, payload: unknown, provenance: Provenance): Edit;
}

export function defineSuggestionKind<S extends z.ZodType>(def: {
  kind: string;
  payload: S;
  itemId: (payload: z.infer<S>) => Id | null;
  accept: (floorId: Id, payload: z.infer<S>, provenance: Provenance) => Edit;
}): SuggestionKindDef {
  return {
    kind: def.kind,
    parse: (payload) => def.payload.parse(payload),
    itemId: (payload) => def.itemId(def.payload.parse(payload)),
    accept: (floorId, payload, provenance) =>
      def.accept(floorId, def.payload.parse(payload), provenance),
  };
}

const spaceKind = (
  kind: string,
  collection: 'walls' | 'openings' | 'rooms' | 'zones',
  schema: z.ZodObject,
) =>
  defineSuggestionKind({
    kind,
    payload: schema,
    itemId: (payload) => (payload as { id: Id }).id,
    accept: (floorId, payload, provenance) =>
      putSpaceItem(floorId, collection, { ...payload, provenance } as never),
  });

const floorHeight = z.object({ height: FloorData.shape.height });
const roomCeilingHeight = z.object({ roomId: Id, ceilingHeight: z.number().positive() });

export const builtInSuggestionKinds: readonly SuggestionKindDef[] = [
  spaceKind('wall', 'walls', Wall.omit({ provenance: true })),
  spaceKind('opening', 'openings', Opening.omit({ provenance: true })),
  spaceKind('room', 'rooms', Room.omit({ provenance: true })),
  spaceKind('zone', 'zones', Zone.omit({ provenance: true })),
  defineSuggestionKind({
    kind: 'scale',
    payload: FloorData.shape.scale.unwrap(),
    itemId: () => null,
    // A scale the person measured wins over any suggested one (M4 decision 2), also when the
    // suggestion was made before they measured.
    accept: (floorId, payload) => (draft, base) => {
      if (base.floors[floorId]?.data.scale?.source === 'user') return;
      setScale(floorId, payload)(draft, base);
    },
  }),
  defineSuggestionKind({
    kind: 'device',
    payload: Device.omit({ provenance: true }),
    itemId: (payload) => payload.id,
    // A device that already exists on the floor is replaced (a correction); otherwise added.
    accept: (floorId, payload, provenance) => (draft, base) => {
      const device = { ...payload, provenance };
      const floor = draft.floors[floorId];
      if (floor && base.floors[floorId]?.data.devices[device.id]) {
        floor.data.devices[device.id] = device;
        return;
      }
      addDevice(floorId, device)(draft, base);
    },
  }),
  defineSuggestionKind({
    kind: 'room-ceiling-height',
    payload: roomCeilingHeight,
    itemId: (payload) => payload.roomId,
    accept: (floorId, payload) => (draft) => {
      const room = draft.floors[floorId]?.data.rooms[payload.roomId];
      if (!room) throw new EditError(`Unknown room ${payload.roomId}`);
      room.ceilingHeight = payload.ceilingHeight;
    },
  }),
  defineSuggestionKind({
    kind: 'floor-height',
    payload: floorHeight,
    itemId: () => null,
    accept: (floorId, payload) => (draft) => {
      const floor = draft.floors[floorId];
      if (!floor) throw new EditError(`Unknown floor ${floorId}`);
      floor.data.height = payload.height;
    },
  }),
];

export interface SuggestionKinds {
  get(kind: string): SuggestionKindDef | undefined;
}

export function createSuggestionKinds(
  kinds: readonly SuggestionKindDef[] = builtInSuggestionKinds,
): SuggestionKinds {
  const map = new Map<string, SuggestionKindDef>();
  for (const def of kinds) {
    if (map.has(def.kind)) throw new Error(`Duplicate suggestion kind: ${def.kind}`);
    map.set(def.kind, def);
  }
  return { get: (kind) => map.get(kind) };
}

export class SuggestionError extends Error {
  override name = 'SuggestionError';
}

export interface AcceptPlan {
  /** One edit for everything, so accepting is a single undo step. */
  edit: Edit;
  /** The requested suggestions plus everything they require, dependencies first. */
  accepted: Suggestion[];
}

/**
 * Plans accepting `ids` from `all` (a floor's suggestions). Required suggestions that are still
 * pending are accepted too; a requirement that was rejected or is missing is an error, because the
 * item would reference something that does not exist.
 */
export function acceptSuggestions(
  kinds: SuggestionKinds,
  all: readonly Suggestion[],
  ids: readonly Id[],
): AcceptPlan {
  const byId = new Map(all.map((s) => [s.id, s]));
  const ordered: Suggestion[] = [];
  const state = new Map<Id, 'visiting' | 'done'>();
  const visit = (id: Id) => {
    const s = byId.get(id);
    if (!s) throw new SuggestionError(`Unknown suggestion ${id}`);
    if (s.status === 'accepted') return;
    if (s.status === 'rejected') throw new SuggestionError(`Suggestion ${id} was rejected`);
    const seen = state.get(id);
    if (seen === 'done') return;
    if (seen === 'visiting') throw new SuggestionError(`Suggestion ${id} requires itself`);
    state.set(id, 'visiting');
    for (const required of s.requires) visit(required);
    state.set(id, 'done');
    ordered.push(s);
  };
  for (const id of ids) visit(id);

  const edits = ordered.map((s) => {
    const def = kinds.get(s.kind);
    if (!def) throw new SuggestionError(`Unknown suggestion kind ${s.kind}`);
    const provenance: Provenance = {
      status: 'confirmed',
      source: s.source,
      ...(s.confidence === undefined ? {} : { confidence: s.confidence }),
    };
    return def.accept(s.floorId, s.payload, provenance);
  });
  return { edit: combine(...edits), accepted: ordered };
}
