import { deviceTypeKey, type DevicePayload, type PhotoDetectableInput } from '@el-karta/ai-passes';
import type { SuggestionDraft } from '@el-karta/core';
import type { FacitDevice, FacitPlace, PhotoFacit } from './facit.ts';

const ROUGH = 'photo.position-rough';

/** A device the pass suggested, as the scoring compares it with the facit. */
export interface FoundDevice {
  type: string;
  wall: FacitPlace;
  offset?: number;
  height?: number;
  count?: number;
  props: Readonly<Record<string, unknown>>;
  /** Flagged `photo.position-rough`. */
  rough: boolean;
}

/** The device suggestions among `drafts`; corrections and other kinds are left out. */
export function foundDevices(drafts: readonly SuggestionDraft[]): FoundDevice[] {
  return drafts.flatMap((draft): FoundDevice[] => {
    if (draft.kind !== 'device') return [];
    const device = draft.payload as DevicePayload;
    const p = device.placement;
    return [
      {
        type: deviceTypeKey(device),
        wall: p.kind === 'wall' ? p.wallId : 'ceiling',
        ...(p.kind === 'wall' ? { offset: p.offset, height: p.height } : {}),
        ...(device.count === undefined ? {} : { count: device.count }),
        props: device.props,
        rough: draft.issues.some((issue) => issue.code === ROUGH),
      },
    ];
  });
}

/** Opening and ceiling-height corrections among `drafts`. */
export const correctionCount = (drafts: readonly SuggestionDraft[]) =>
  drafts.filter((d) => d.kind === 'opening' || d.kind === 'room-ceiling-height').length;

/** One facit device paired with one found device. */
export interface DevicePair {
  expected: number;
  found: number;
  typeRight: boolean;
  wallRight: boolean;
}

/** Offset distance when both are on the same wall with an offset; otherwise unknown. */
function distance(e: FacitDevice, f: FoundDevice): number {
  return e.wall === f.wall && e.offset !== undefined && f.offset !== undefined
    ? Math.abs(e.offset - f.offset)
    : Infinity;
}

/**
 * Pairs facit devices with found ones greedily, in three rounds: same type on the same wall (the
 * ceiling counts as a wall), then same type on another wall, then another type on the same wall.
 * Within a round the pairs nearest in offset go first; pairs without a comparable offset come after
 * them, in facit order and then found order. Each device is in at most one pair.
 */
export function matchDevices(
  expected: readonly FacitDevice[],
  found: readonly FoundDevice[],
): DevicePair[] {
  const pairs: DevicePair[] = [];
  const usedE = new Set<number>();
  const usedF = new Set<number>();
  const rounds: ((e: FacitDevice, f: FoundDevice) => boolean)[] = [
    (e, f) => e.type === f.type && e.wall === f.wall,
    (e, f) => e.type === f.type,
    (e, f) => e.wall === f.wall,
  ];
  for (const fits of rounds) {
    const candidates: { e: number; f: number; d: number }[] = [];
    expected.forEach((e, i) => {
      if (usedE.has(i)) return;
      found.forEach((f, j) => {
        if (!usedF.has(j) && fits(e, f)) candidates.push({ e: i, f: j, d: distance(e, f) });
      });
    });
    candidates.sort((a, b) => (a.d === b.d ? 0 : a.d < b.d ? -1 : 1) || a.e - b.e || a.f - b.f);
    for (const { e, f } of candidates) {
      if (usedE.has(e) || usedF.has(f)) continue;
      usedE.add(e);
      usedF.add(f);
      pairs.push({
        expected: e,
        found: f,
        typeRight: expected[e]!.type === found[f]!.type,
        wallRight: expected[e]!.wall === found[f]!.wall,
      });
    }
  }
  return pairs.sort((a, b) => a.expected - b.expected);
}

/** Scores of one photo; every column is defined in `evals/photo/README.md`. */
export interface PhotoScores {
  expected: number;
  found: number | undefined;
  matched: number | undefined;
  precision: number | undefined;
  recall: number | undefined;
  typeAccuracy: number | undefined;
  wallAccuracy: number | undefined;
  countAccuracy: number | undefined;
  countsByType: string | undefined;
  unitCountAccuracy: number | undefined;
  propsAccuracy: number | undefined;
  meanOffsetError: number | undefined;
  meanHeightError: number | undefined;
  roughShare: number | undefined;
  corrections: number | undefined;
}

const share = (part: number, whole: number) => (whole === 0 ? undefined : part / whole);
const meanOf = (values: readonly number[]) =>
  values.length === 0 ? undefined : values.reduce((s, v) => s + v, 0) / values.length;

/** Found and expected devices per type, sorted by type. */
export function countsByType(
  expected: readonly Pick<FacitDevice, 'type'>[],
  found: readonly Pick<FoundDevice, 'type'>[],
): Map<string, { found: number; expected: number }> {
  const counts = new Map<string, { found: number; expected: number }>();
  const entry = (type: string) => {
    const c = counts.get(type) ?? { found: 0, expected: 0 };
    counts.set(type, c);
    return c;
  };
  for (const e of expected) entry(e.type).expected++;
  for (const f of found) entry(f.type).found++;
  return new Map([...counts].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** As one cell, e.g. `power.outlet=2/3 power.switch=1/1` (found/expected). */
export const formatCounts = (counts: ReadonlyMap<string, { found: number; expected: number }>) =>
  [...counts].map(([type, c]) => `${type}=${c.found}/${c.expected}`).join(' ');

/** Parses `formatCounts` back; unreadable parts are skipped. */
export function parseCounts(text: string): Map<string, { found: number; expected: number }> {
  const counts = new Map<string, { found: number; expected: number }>();
  for (const part of text.split(' ')) {
    const match = /^(.+)=(\d+)\/(\d+)$/.exec(part);
    if (match) counts.set(match[1]!, { found: Number(match[2]), expected: Number(match[3]) });
  }
  return counts;
}

/**
 * 1 − Σ|found − expected| / Σ max(found, expected) over the types; per type that is
 * min / max. 1 when nothing was expected and nothing found.
 */
export function countAccuracy(counts: Iterable<{ found: number; expected: number }>): number {
  let off = 0;
  let most = 0;
  for (const c of counts) {
    off += Math.abs(c.found - c.expected);
    most += Math.max(c.found, c.expected);
  }
  return most === 0 ? 1 : 1 - off / most;
}

export function scorePhoto(
  facit: PhotoFacit,
  found: readonly FoundDevice[],
  corrections: number,
  detectable: readonly PhotoDetectableInput[],
): PhotoScores {
  const expected = facit.devices;
  const pairs = matchDevices(expected, found);
  const exact = pairs.filter((p) => p.typeRight && p.wallRight);
  const counts = countsByType(expected, found);
  const visible = new Map(detectable.map((d) => [deviceTypeKey(d), d.visibleProps ?? {}]));

  const units = exact.flatMap(({ expected: e, found: f }) => {
    const want = expected[e]!.count;
    return want === undefined ? [] : [found[f]!.count === want];
  });
  const props = exact.flatMap(({ expected: e, found: f }) => {
    const shown = visible.get(expected[e]!.type) ?? {};
    return (
      Object.entries(expected[e]!.props ?? {})
        .filter(([name]) => name in shown)
        // The pass stores props as the strings the model read.
        .map(([name, value]) => found[f]!.props[name] === String(value))
    );
  });
  const errors = (field: 'offset' | 'height') =>
    exact.flatMap(({ expected: e, found: f }) => {
      const want = expected[e]![field];
      const got = found[f]![field];
      return want === undefined || got === undefined ? [] : [Math.abs(got - want)];
    });

  return {
    expected: expected.length,
    found: found.length,
    matched: pairs.length,
    precision: share(exact.length, found.length),
    recall: share(exact.length, expected.length),
    typeAccuracy: share(pairs.filter((p) => p.typeRight).length, pairs.length),
    wallAccuracy: share(pairs.filter((p) => p.wallRight).length, pairs.length),
    countAccuracy: countAccuracy(counts.values()),
    countsByType: formatCounts(counts),
    unitCountAccuracy: share(units.filter(Boolean).length, units.length),
    propsAccuracy: share(props.filter(Boolean).length, props.length),
    meanOffsetError: meanOf(errors('offset')),
    meanHeightError: meanOf(errors('height')),
    roughShare: share(found.filter((f) => f.rough).length, found.length),
    corrections,
  };
}

/** A run that produced no output: only what was expected is known. */
export const failedPhotoScores = (facit: PhotoFacit): PhotoScores => ({
  expected: facit.devices.length,
  found: undefined,
  matched: undefined,
  precision: undefined,
  recall: undefined,
  typeAccuracy: undefined,
  wallAccuracy: undefined,
  countAccuracy: undefined,
  countsByType: undefined,
  unitCountAccuracy: undefined,
  propsAccuracy: undefined,
  meanOffsetError: undefined,
  meanHeightError: undefined,
  roughShare: undefined,
  corrections: undefined,
});
