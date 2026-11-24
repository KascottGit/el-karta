import {
  add,
  distance,
  normalize,
  scale as times,
  sub,
  wallFacePoint,
  type Device,
  type FloorCollection,
  type FloorData,
  type FloorScale,
  type Id,
  type Opening,
  type Pt,
  type Room,
  type Wall,
  type Zone,
} from '@el-karta/core';
import type { TFunction } from 'i18next';
import { deviceAppearance, type MarkerShape } from '@/features/devices/appearance';
import { deviceTypeName } from '@/features/devices/type-name';
import type { MessageKey } from '@/features/floorplan/canvas/extension';
import { formatDecimal } from '@/features/floorplan/fields/numbers';

export type WallLike = Pick<Wall, 'a' | 'b' | 'thickness'>;

/** What a pending suggestion looks like on the canvas, in plan metres. */
export type GhostShape =
  | { type: 'line'; role: 'wall' | 'opening'; a: Pt; b: Pt; thickness: number }
  | { type: 'area'; role: 'area'; polygon: readonly Pt[]; label: string }
  /** A device's marker at its position on the plan. */
  | { type: 'marker'; role: 'device'; at: Pt; shape: MarkerShape };

/**
 * How the editor shows one suggestion kind. The payload it gets has already passed the kind's
 * schema from the core registry (`createSuggestionKinds`), so a view only adds presentation.
 */
export interface SuggestionView {
  kind: string;
  /** Group heading in the list, with the count. */
  title: MessageKey;
  /** Groups are listed lowest first. */
  order: number;
  /** The collection the accepted item lands in, so "accept and edit" can select it. */
  collection?: FloorCollection;
  /** A value of the whole floor (scale, height), listed above the groups instead of drawn. */
  floorValue?: boolean;
  ghost?(payload: unknown, wall: (id: Id) => WallLike | undefined): GhostShape | null;
  /** `floor` is the floor the suggestion is on, to say what a correction changes. */
  describe(payload: unknown, t: TFunction, floor?: FloorData): string;
}

/** The part of a wall from `offset` to `offset + width` metres from its end `a`. */
export function wallSpan(wall: WallLike, offset: number, width: number): { a: Pt; b: Pt } {
  const dir = normalize(sub(wall.b, wall.a));
  return { a: add(wall.a, times(dir, offset)), b: add(wall.a, times(dir, offset + width)) };
}

const metres = (v: number) => formatDecimal(v, 2);
/** With both decimals, so a change from 1,00 to 1,20 m reads as one. */
const fixedMetres = (v: number) => formatDecimal(v, 2, 2);

const change = (t: TFunction, from: number, to: number) =>
  t('suggestions.describe.change', { from: fixedMetres(from), to: fixedMetres(to) });

/** Within a millimetre counts as unchanged. */
const differs = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? a !== b : Math.abs(a - b) >= 0.0005;

const wallView: SuggestionView = {
  kind: 'wall',
  title: 'suggestions.kinds.wall',
  order: 10,
  collection: 'walls',
  ghost: (payload) => {
    const { a, b, thickness } = payload as Wall;
    return { type: 'line', role: 'wall', a, b, thickness };
  },
  describe: (payload, t) =>
    t('suggestions.describe.wall', {
      length: metres(distance((payload as Wall).a, (payload as Wall).b)),
    }),
};

const openingView: SuggestionView = {
  kind: 'opening',
  title: 'suggestions.kinds.opening',
  order: 20,
  collection: 'openings',
  ghost: (payload, wall) => {
    const opening = payload as Opening;
    const on = wall(opening.wallId);
    if (!on) return null;
    const span = wallSpan(on, opening.offset, opening.width);
    return { type: 'line', role: 'opening', ...span, thickness: on.thickness };
  },
  describe: (payload, t, floor) => {
    const opening = payload as Opening;
    const kind = t(`openings.kinds.${opening.kind}`);
    const current = floor?.openings[opening.id];
    if (!current) return t('suggestions.describe.opening', { kind, width: metres(opening.width) });
    const changes = (['width', 'height', 'sill'] as const)
      .filter((key) => differs(current[key], opening[key]))
      .map((key) => {
        const what = t(`suggestions.describe.dimension.${key}`);
        const value = change(t, current[key] ?? 0, opening[key] ?? 0);
        return t('suggestions.describe.dimensionChange', { what, change: value });
      });
    return t('suggestions.describe.correction', {
      item: kind,
      changes: changes.length > 0 ? changes.join(', ') : t('suggestions.describe.unchanged'),
    });
  },
};

/** A device's marker point: on its wall's face, or where it hangs from the ceiling. */
function devicePoint(device: Device, wall: (id: Id) => WallLike | undefined): Pt | null {
  const p = device.placement;
  if (p.kind === 'ceiling' || p.kind === 'floor') return p.at;
  if (p.kind !== 'wall') return null;
  const on = wall(p.wallId);
  return on ? wallFacePoint(on, p.offset, p.side) : null;
}

const deviceView: SuggestionView = {
  kind: 'device',
  title: 'suggestions.kinds.device',
  order: 50,
  collection: 'devices',
  ghost: (payload, wall) => {
    const device = payload as Device;
    const at = devicePoint(device, wall);
    return at && { type: 'marker', role: 'device', at, shape: deviceAppearance(device).shape };
  },
  describe: (payload, t) => {
    const device = payload as Device;
    const type = deviceTypeName(device);
    return device.count !== undefined && device.count > 1
      ? t('suggestions.describe.deviceCount', { type, count: device.count })
      : type;
  },
};

const ceilingHeightView: SuggestionView = {
  kind: 'room-ceiling-height',
  title: 'suggestions.kinds.room-ceiling-height',
  order: 60,
  collection: 'rooms',
  describe: (payload, t, floor) => {
    const { roomId, ceilingHeight } = payload as { roomId: Id; ceilingHeight: number };
    const room = floor?.rooms[roomId];
    const item = t('suggestions.describe.ceilingHeight', {
      room: room?.name || t('areas.room'),
    });
    const from = room?.ceilingHeight ?? floor?.height;
    return from === undefined
      ? t('suggestions.describe.value', { item, value: metres(ceilingHeight) })
      : t('suggestions.describe.correction', { item, changes: change(t, from, ceilingHeight) });
  },
};

const areaView = (kind: 'room' | 'zone', order: number): SuggestionView => ({
  kind,
  title: `suggestions.kinds.${kind}`,
  order,
  collection: kind === 'room' ? 'rooms' : 'zones',
  ghost: (payload) => {
    const { polygon, name } = payload as Room | Zone;
    return polygon.length >= 3 ? { type: 'area', role: 'area', polygon, label: name } : null;
  },
  describe: (payload, t) => {
    const area = payload as Room | Zone;
    const name = area.name || t(kind === 'room' ? 'areas.room' : 'areas.zone');
    if (!('type' in area)) return name;
    const type = t(`areas.roomType.${area.type}`);
    return name.toLowerCase() === type.toLowerCase()
      ? name
      : t('suggestions.describe.room', { name, type });
  },
});

const scaleView: SuggestionView = {
  kind: 'scale',
  title: 'suggestions.kinds.scale',
  order: 0,
  floorValue: true,
  describe: (payload, t) => {
    const scale = payload as FloorScale;
    return t('suggestions.describe.scale', {
      mm: formatDecimal(scale.metresPerPixel * 1000, 3),
      source: t(`background.scaleSource.${scale.source}`),
    });
  },
};

const floorHeightView: SuggestionView = {
  kind: 'floor-height',
  title: 'suggestions.kinds.floor-height',
  order: 1,
  floorValue: true,
  describe: (payload, t) =>
    t('suggestions.describe.floor-height', {
      height: metres((payload as { height: number }).height),
    }),
};

/** A kind with no view of its own (from a later pass) is listed with a generic line and not drawn. */
const unknownView = (kind: string): SuggestionView => ({
  kind,
  title: 'suggestions.kinds.other',
  order: 1000,
  describe: (_payload, t) => t('suggestions.describe.other', { kind }),
});

const views = new Map<string, SuggestionView>(
  [
    wallView,
    openingView,
    areaView('room', 30),
    areaView('zone', 40),
    deviceView,
    ceilingHeightView,
    scaleView,
    floorHeightView,
  ].map((v) => [v.kind, v]),
);

export const suggestionView = (kind: string): SuggestionView =>
  views.get(kind) ?? unknownView(kind);
