import {
  distance,
  Opening,
  Room,
  signedArea,
  Wall,
  type Pt,
  type RoomType,
  type SuggestionDraft,
} from '@el-karta/core';
import { wallRotationDeg, type Facit, type FacitRoom } from './facit.ts';

/** `printed`: the normal import. `estimate`: printed scale evidence hidden, estimating allowed. */
export type EvalMode = 'printed' | 'estimate';

/**
 * What a run produced. Geometry is in image widths (metres divided by the metres per image width it
 * was measured at), in the image frame of `FacitWall`, so it compares with the facit whatever scale
 * the run found: geometry errors measure geometry only, and `scaleError` measures the scale.
 */
export interface PlanReading {
  /** `area` in square image widths; null for rooms whose walls did not close. */
  rooms: { name: string; type: RoomType; area: number | null }[];
  doors: number;
  windows: number;
  /** In image widths. */
  walls: { a: Pt; b: Pt }[];
  /** The scale the run found; null when it found none. */
  metresPerImageWidth: number | null;
}

const RoomPayload = Room.pick({ name: true, type: true, polygon: true });
const WallPayload = Wall.pick({ a: true, b: true });
const OpeningPayload = Opening.pick({ kind: true });

export interface ReadingScale {
  /** The scale the run found, or null. */
  found: number | null;
  /** Metres per image width the drafts' geometry is in: the found scale or the placeholder. */
  geometry: number;
}

/** The reading of a run's suggestion drafts, with geometry converted to image widths. */
export function readingFromDrafts(
  drafts: readonly SuggestionDraft[],
  scale: ReadingScale,
): PlanReading {
  const k = 1 / scale.geometry;
  const toWidths = (p: Pt): Pt => ({ x: p.x * k, y: p.y * k });
  const reading: PlanReading = {
    rooms: [],
    doors: 0,
    windows: 0,
    walls: [],
    metresPerImageWidth: scale.found,
  };
  for (const draft of drafts) {
    if (draft.kind === 'room') {
      const room = RoomPayload.parse(draft.payload);
      const open = draft.issues.some((i) => i.code === 'ai.room-open');
      const area =
        open || room.polygon.length < 3 ? null : Math.abs(signedArea(room.polygon)) * k * k;
      reading.rooms.push({ name: room.name, type: room.type, area });
    } else if (draft.kind === 'wall') {
      const wall = WallPayload.parse(draft.payload);
      reading.walls.push({ a: toWidths(wall.a), b: toWidths(wall.b) });
    } else if (draft.kind === 'opening') {
      const { kind } = OpeningPayload.parse(draft.payload);
      if (kind === 'door') reading.doors++;
      if (kind === 'window') reading.windows++;
    }
  }
  return reading;
}

export interface FloorplanScores {
  roomsExpected: number;
  roomsFound: number;
  /** Facit rooms matched by name (unlabelled ones match any room left), over all facit rooms. */
  nameMatch: number;
  /** Matched rooms whose type is one of the facit's, over matched rooms; null with no match. */
  typeAccuracy: number | null;
  doorsExpected: number;
  doorsFound: number;
  /** Found over facit metres per image width, minus 1; null without a facit scale or a found one. */
  scaleError: number | null;
  /** Estimate mode only, on plans with a facit scale: the estimate is within 10 %. */
  estimateWithin10: boolean | null;
  /** Smallest angle between the found and the facit main wall direction (mod 90°). */
  rotationErrorDeg: number | null;
  /**
   * Mean absolute relative area error of matched rooms that have both areas, compared in square
   * image widths so a wrong scale does not count; null when the facit has no scale.
   */
  roomAreaError: number | null;
  /** Full facit only: total wall length over the facit's, in image widths, minus 1. */
  wallLengthError: number | null;
}

/** Estimates within this fraction of the facit scale count as good enough. */
export const ESTIMATE_TOLERANCE = 0.1;

/** Lower-case with all whitespace removed, so "WC / D" matches "WC/D". */
export const normalizeName = (name: string) => name.toLowerCase().replace(/\s+/g, '');

/**
 * Pairs facit rooms with found rooms one to one: labelled facit rooms by normalised name first,
 * then unlabelled ones with any room left, preferring one of an accepted type.
 */
export function matchRooms<R extends { name: string; type: RoomType }>(
  facit: readonly FacitRoom[],
  found: readonly R[],
): [FacitRoom, R][] {
  const used = new Set<number>();
  const pairs: [FacitRoom, R][] = [];
  const take = (f: FacitRoom, test: (r: R) => boolean) => {
    const index = found.findIndex((r, i) => !used.has(i) && test(r));
    if (index < 0) return false;
    used.add(index);
    pairs.push([f, found[index]!]);
    return true;
  };
  for (const f of facit) {
    const name = f.name;
    if (name !== null) take(f, (r) => normalizeName(r.name) === normalizeName(name));
  }
  for (const f of facit) {
    if (f.name !== null) continue;
    if (!take(f, (r) => f.types.includes(r.type))) take(f, () => true);
  }
  return pairs;
}

const wrap90 = (deg: number) => {
  const r = deg - 90 * Math.round(deg / 90);
  return Math.abs(r);
};

const mean = (values: readonly number[]) =>
  values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;

const totalLength = (walls: readonly { a: Pt; b: Pt }[]) =>
  walls.reduce((s, w) => s + distance(w.a, w.b), 0);

/**
 * The scores of a run that produced nothing to score. An estimate mode run on a plan with a known
 * scale still counts as an estimate that missed.
 */
export function failedRunScores(facit: Facit, mode: EvalMode): Partial<FloorplanScores> {
  return {
    roomsExpected: facit.rooms.length,
    doorsExpected: facit.doors,
    estimateWithin10: mode === 'estimate' && facit.scale !== null ? false : null,
  };
}

export function scoreFloorplan(
  facit: Facit,
  reading: PlanReading,
  mode: EvalMode,
): FloorplanScores {
  const pairs = matchRooms(facit.rooms, reading.rooms);
  const typed = pairs.filter(([f, r]) => f.types.includes(r.type)).length;

  const facitScale = facit.scale?.metresPerImageWidth ?? null;
  const found = reading.metresPerImageWidth;
  const scaleError = facitScale !== null && found !== null ? found / facitScale - 1 : null;
  const estimateWithin10 =
    mode === 'estimate' && facitScale !== null
      ? scaleError !== null && Math.abs(scaleError) <= ESTIMATE_TOLERANCE + 1e-9
      : null;

  const rotation = wallRotationDeg(reading.walls);
  const areaErrors =
    facitScale === null
      ? []
      : pairs.flatMap(([f, r]) =>
          f.area !== null && r.area !== null
            ? [Math.abs((r.area * facitScale ** 2) / f.area - 1)]
            : [],
        );
  const facitLength =
    facit.level === 'full' ? totalLength(facit.walls) / facit.scale.metresPerImageWidth : 0;

  return {
    roomsExpected: facit.rooms.length,
    roomsFound: reading.rooms.length,
    nameMatch: facit.rooms.length === 0 ? 1 : pairs.length / facit.rooms.length,
    typeAccuracy: pairs.length === 0 ? null : typed / pairs.length,
    doorsExpected: facit.doors,
    doorsFound: reading.doors,
    scaleError,
    estimateWithin10,
    rotationErrorDeg: rotation === null ? null : wrap90(rotation - facit.rotationDeg),
    roomAreaError: mean(areaErrors),
    wallLengthError: facitLength > 0 ? totalLength(reading.walls) / facitLength - 1 : null,
  };
}
