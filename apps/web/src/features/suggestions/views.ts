import {
  add,
  distance,
  normalize,
  scale as times,
  sub,
  type FloorCollection,
  type FloorScale,
  type Id,
  type Opening,
  type Pt,
  type Room,
  type Wall,
  type Zone,
} from '@el-karta/core';
import type { TFunction } from 'i18next';
import type { MessageKey } from '@/features/floorplan/canvas/extension';
import { formatDecimal } from '@/features/floorplan/fields/numbers';

export type WallLike = Pick<Wall, 'a' | 'b' | 'thickness'>;

/** What a pending suggestion looks like on the canvas, in plan metres. */
export type GhostShape =
  | { type: 'line'; role: 'wall' | 'opening'; a: Pt; b: Pt; thickness: number }
  | { type: 'area'; role: 'area'; polygon: readonly Pt[]; label: string };

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
  describe(payload: unknown, t: TFunction): string;
}

/** The part of a wall from `offset` to `offset + width` metres from its end `a`. */
export function wallSpan(wall: WallLike, offset: number, width: number): { a: Pt; b: Pt } {
  const dir = normalize(sub(wall.b, wall.a));
  return { a: add(wall.a, times(dir, offset)), b: add(wall.a, times(dir, offset + width)) };
}

const metres = (v: number) => formatDecimal(v, 2);

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
  describe: (payload, t) => {
    const opening = payload as Opening;
    return t('suggestions.describe.opening', {
      kind: t(`openings.kinds.${opening.kind}`),
      width: metres(opening.width),
    });
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
    scaleView,
    floorHeightView,
  ].map((v) => [v.kind, v]),
);

export const suggestionView = (kind: string): SuggestionView =>
  views.get(kind) ?? unknownView(kind);
