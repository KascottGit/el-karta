import {
  add,
  centroid,
  dot,
  scale,
  sub,
  type Device,
  type Id,
  type Pt,
  type SuggestionDraft,
  type SuggestionIssue,
} from '@el-karta/core';
import { clampNorm, type NormBox } from '../image.ts';
import {
  applyHomography,
  distinctPoints,
  fitHomography,
  MIN_FIT_POINTS,
  PLANE_TOLERANCE,
  rmsResidual,
  type Homography,
  type XY,
} from './homography.ts';
import { planeRef, wallFrame, type PlaneRef, type WallFrame } from './plane.ts';
import { deviceIndex, wallIndex } from './refs.ts';
import {
  deviceTypeKey,
  type PhotoDetectableInput,
  type PhotoFeature,
  type PhotoInput,
  type PhotoOutput,
} from './schema.ts';

/**
 * What turning a photo output into suggestions needs: the pass input without its images, the
 * photo's attachment id (the evidence every device gets), and the device suggestions and
 * corrections still pending on the floor, so a second photo suggests nothing twice.
 */
export type PhotoSuggestOptions = Omit<PhotoInput, 'image' | 'earlier'> & {
  photoId: Id;
  pending: readonly Pick<Device, 'domain' | 'type' | 'placement'>[];
  /** Openings with a pending `opening` suggestion, rooms with a pending `room-ceiling-height`. */
  pendingCorrections: { openingIds: readonly Id[]; roomIds: readonly Id[] };
};

export type DevicePayload = Omit<Device, 'provenance'>;
type OpeningPayload = PhotoInput['openings'][number];

/** A feature this close along the wall to a device of the same type is that device (decision 5). */
export const DUPLICATE_REACH = 0.3;
/** Openings and the ceiling are only checked with at least this many distinct fit points. */
export const MIN_CHECK_POINTS = 5;
export const OPENING_TOLERANCE = 0.1;
export const CEILING_TOLERANCE = 0.05;
/** Ceiling corners must agree this closely with each other to measure the ceiling. */
const CEILING_AGREEMENT = 0.05;
/** A fitted point this far outside the wall face, the floor or the ceiling is not trusted. */
export const OUTSIDE_REACH = 0.2;
/** A wall whose fit misses its own points by more than this (RMS, metres) is placed roughly. */
export const MAX_RESIDUAL = 0.1;
/** A rough position keeps this share of the model's confidence. */
export const ROUGH_CONFIDENCE = 0.5;
const CEILING_RANGE = { min: 1.8, max: 6 } as const;

const ROUGH: SuggestionIssue = { code: 'photo.position-rough', severity: 'warning' };

const cm = (m: number) => Math.round(m * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mean = (values: readonly number[]) => values.reduce((s, v) => s + v, 0) / values.length;
const centre = (box: NormBox): XY =>
  clampNorm({ x: (box.xmin + box.xmax) / 2, y: (box.ymin + box.ymax) / 2 });

interface Located {
  ref: PlaneRef;
  image: XY;
}

interface Fit {
  homography: Homography;
  /**
   * The noise of one point on the plane, in metres: the RMS residual at the fit's own points,
   * scaled up for the 8 parameters the fit spends on them (2n equations, 2n − 8 left over).
   */
  sigma: number;
  /** Distinct plane points it was fitted from. */
  points: number;
}

interface WallFit {
  frame: WallFrame;
  refs: Located[];
  fitRefs: Located[];
  fit: Fit | null;
}

const usable = (r: Located) => r.ref.v !== null && !r.ref.ceiling;

function fitOf(refs: readonly Located[]): Fit | null {
  if (refs.length < MIN_FIT_POINTS) return null;
  const pairs = refs.map((r) => ({ image: r.image, plane: { x: r.ref.u, y: r.ref.v ?? 0 } }));
  const homography = fitHomography(pairs);
  if (!homography) return null;
  const planes = pairs.map((p) => p.plane);
  const spare = 2 * pairs.length - 8;
  return {
    homography,
    sigma: spare > 0 ? rmsResidual(homography, pairs) * Math.sqrt((2 * pairs.length) / spare) : 0,
    points: distinctPoints(planes, PLANE_TOLERANCE).length,
  };
}

const withoutOpenings = (wall: WallFit, excluded: ReadonlySet<number>) =>
  wall.fitRefs.filter((r) => r.ref.opening === null || !excluded.has(r.ref.opening));

/** A fit good enough to check openings and the ceiling against: 5 or more distinct points. */
function checkFit(refs: readonly Located[]): Fit | null {
  const fit = fitOf(refs);
  return fit && fit.points >= MIN_CHECK_POINTS ? fit : null;
}

function wallFits(output: PhotoOutput, options: PhotoSuggestOptions): WallFit[] {
  const frames = options.walls.map((w) => wallFrame(w, options.room.polygon));
  const located = output.references.flatMap((r): Located[] => {
    const ref = planeRef(r, options, frames);
    return ref ? [{ ref, image: clampNorm(r.point) }] : [];
  });
  return frames.map((frame, i) => {
    const refs = located.filter((r) => r.ref.wall === i);
    const fitRefs = refs.filter(usable);
    return { frame, refs, fitRefs, fit: fitOf(fitRefs) };
  });
}

/**
 * `u` for an image x without a fit: linear between the nearest references left and right of it
 * along the wall (extrapolated past the outermost two), the one reference's `u`, or the middle of
 * the face.
 */
export function roughOffset(
  refs: readonly { x: number; u: number }[],
  x: number,
  frame: WallFrame,
) {
  const groups: { x: number; u: number; n: number }[] = [];
  for (const r of refs) {
    const g = groups.find((g) => Math.abs(g.u - r.u) < 0.01);
    if (g) {
      g.x = (g.x * g.n + r.x) / (g.n + 1);
      g.n++;
    } else groups.push({ ...r, n: 1 });
  }
  groups.sort((a, b) => a.x - b.x);
  let u: number;
  if (groups.length === 0) u = (frame.start + frame.end) / 2;
  else if (groups.length === 1) u = groups[0]!.u;
  else {
    const right = groups.findIndex((g) => g.x > x);
    let hi = right;
    if (right === -1) hi = groups.length - 1;
    if (right === 0) hi = 1;
    const lo = groups[hi - 1]!;
    const up = groups[hi]!;
    u = up.x === lo.x ? lo.u : lo.u + ((x - lo.x) / (up.x - lo.x)) * (up.u - lo.u);
  }
  return clamp(u, frame.start, frame.end);
}

function deviceDraft(
  payload: DevicePayload,
  confidence: number,
  rough: boolean,
  newId: () => Id,
): SuggestionDraft {
  return {
    id: newId(),
    kind: 'device',
    payload,
    confidence: rough ? confidence * ROUGH_CONFIDENCE : confidence,
    issues: rough ? [ROUGH] : [],
    requires: [],
  };
}

function basePayload(
  type: PhotoDetectableInput,
  feature: PhotoFeature,
  placement: Device['placement'],
  options: PhotoSuggestOptions,
  newId: () => Id,
): DevicePayload {
  const props = Object.fromEntries(
    feature.props
      .filter((p) => type.visibleProps?.[p.name]?.includes(p.value))
      .map((p) => [p.name, p.value]),
  );
  return {
    id: newId(),
    domain: type.domain,
    type: type.type,
    label: '',
    roomId: options.room.id,
    placement,
    ...(type.countable && feature.count !== null && feature.count >= 1
      ? { count: feature.count }
      : {}),
    props,
    ports: type.ports.map((p) => ({ id: newId(), domain: p.domain, kind: p.kind })),
    attachmentIds: [options.photoId],
  };
}

/** Points for `count` lights on the room's long axis, centred on its centroid. */
export function ceilingSlots(polygon: readonly Pt[], count: number): Pt[] {
  const c = centroid(polygon);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of polygon) {
    const d = sub(p, c);
    sxx += d.x * d.x;
    syy += d.y * d.y;
    sxy += d.x * d.y;
  }
  const angle = Math.atan2(2 * sxy, sxx - syy) / 2;
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const along = polygon.map((p) => dot(sub(p, c), axis));
  const length = Math.max(...along) - Math.min(...along);
  return Array.from({ length: count }, (_, i) =>
    add(c, scale(axis, ((i + 0.5) / count - 0.5) * length)),
  );
}

type Placed = Pick<Device, 'domain' | 'type' | 'placement'>;

function nearKnown(known: readonly Placed[], candidate: DevicePayload): boolean {
  const p = candidate.placement;
  if (p.kind !== 'wall') return false;
  return known.some(
    (d) =>
      d.domain === candidate.domain &&
      d.type === candidate.type &&
      d.placement.kind === 'wall' &&
      d.placement.wallId === p.wallId &&
      d.placement.side === p.side &&
      Math.abs(d.placement.offset - p.offset) <= DUPLICATE_REACH,
  );
}

const area = (b: NormBox) => Math.max(0, b.xmax - b.xmin) * Math.max(0, b.ymax - b.ymin);
const inside = (p: XY, b: NormBox) =>
  p.x >= b.xmin && p.x <= b.xmax && p.y >= b.ymin && p.y <= b.ymax;

/** Whether two features of one photo are the same device reported twice. */
export function sameReport(a: PhotoFeature, b: PhotoFeature): boolean {
  if (a.deviceType !== b.deviceType) return false;
  const overlap = area({
    xmin: Math.max(a.box.xmin, b.box.xmin),
    ymin: Math.max(a.box.ymin, b.box.ymin),
    xmax: Math.min(a.box.xmax, b.box.xmax),
    ymax: Math.min(a.box.ymax, b.box.ymax),
  });
  const union = area(a.box) + area(b.box) - overlap;
  return (
    (union > 0 && overlap / union > 0.5) ||
    inside(centre(a.box), b.box) ||
    inside(centre(b.box), a.box)
  );
}

/** The fit to place features with, or null when there is none or it misses its own points. */
const placingFit = (wall: WallFit): Fit | null =>
  wall.fit && !(wall.fit.points >= MIN_CHECK_POINTS && wall.fit.sigma > MAX_RESIDUAL)
    ? wall.fit
    : null;

function wallDevices(
  output: PhotoOutput,
  options: PhotoSuggestOptions,
  fits: readonly WallFit[],
  types: ReadonlyMap<string, PhotoDetectableInput>,
  newId: () => Id,
): SuggestionDraft[] {
  // Within one photo only a device reported twice is a duplicate: two real outlets may sit closer
  // than the 0.3 m that identifies a device seen before.
  const known: Placed[] = [...options.devices, ...options.pending];
  const reported: PhotoFeature[] = [];
  const drafts: SuggestionDraft[] = [];
  const ceilingHeight = options.room.ceilingHeight;
  for (const feature of output.features) {
    const type = types.get(feature.deviceType);
    if (!type || type.placement !== 'wall' || isExisting(feature, options)) continue;
    const index = wallIndex(feature.wall, options.walls.length);
    const wall = index === null ? undefined : options.walls[index];
    const wallFit = index === null ? undefined : fits[index];
    if (!wall || !wallFit) continue;
    if (reported.some((r) => sameReport(r, feature))) continue;
    reported.push(feature);

    const point = centre(feature.box);
    const fit = placingFit(wallFit);
    const mapped = fit ? applyHomography(fit.homography, point) : null;
    const { frame } = wallFit;
    let offset: number;
    let height: number;
    let rough: boolean;
    if (mapped) {
      offset = clamp(mapped.x, frame.start, frame.end);
      height = clamp(mapped.y, 0, ceilingHeight);
      rough =
        Math.abs(offset - mapped.x) > OUTSIDE_REACH || Math.abs(height - mapped.y) > OUTSIDE_REACH;
    } else {
      offset = roughOffset(
        wallFit.refs.map((r) => ({ x: r.image.x, u: r.ref.u })),
        point.x,
        frame,
      );
      height = type.defaultHeight ?? ceilingHeight / 2;
      rough = true;
    }
    const payload = basePayload(
      type,
      feature,
      { kind: 'wall', wallId: wall.id, offset: cm(offset), height: cm(height), side: wall.side },
      options,
      newId,
    );
    if (nearKnown(known, payload)) continue;
    drafts.push(deviceDraft(payload, feature.confidence, rough, newId));
  }
  return drafts;
}

const existingIndex = (feature: PhotoFeature, options: PhotoSuggestOptions) =>
  feature.existing === null ? null : deviceIndex(feature.existing, options.devices.length);
const isExisting = (feature: PhotoFeature, options: PhotoSuggestOptions) =>
  existingIndex(feature, options) !== null;

/**
 * Ceiling lights are not located from a photo. Of the lights a photo shows of a type, those the
 * model matched to existing devices are skipped, and the rest, less the other lights of that type
 * already in the room (in the model or pending), become suggestions in the slots on the long axis
 * left free by all of those, always as rough positions.
 */
function ceilingDevices(
  output: PhotoOutput,
  options: PhotoSuggestOptions,
  types: ReadonlyMap<string, PhotoDetectableInput>,
  newId: () => Id,
): SuggestionDraft[] {
  const byType = new Map<string, PhotoFeature[]>();
  for (const feature of output.features) {
    if (types.get(feature.deviceType)?.placement !== 'ceiling') continue;
    byType.set(feature.deviceType, [...(byType.get(feature.deviceType) ?? []), feature]);
  }
  const drafts: SuggestionDraft[] = [];
  for (const [key, features] of byType) {
    const type = types.get(key)!;
    const matched = new Set(
      features.flatMap((f) => {
        const i = existingIndex(f, options);
        return i === null ? [] : [i];
      }),
    );
    const atCeiling = (d: Placed): Pt[] =>
      deviceTypeKey(d) === key &&
      d.placement.kind === 'ceiling' &&
      d.placement.roomId === options.room.id
        ? [d.placement.at]
        : [];
    const matchedAt = options.devices.filter((_, i) => matched.has(i)).flatMap(atCeiling);
    const there = [
      ...options.devices.filter((_, i) => !matched.has(i)),
      ...options.pending,
    ].flatMap(atCeiling);
    const unmatched = features
      .filter((f) => !isExisting(f, options))
      .sort((a, b) => b.confidence - a.confidence);
    const fresh = Math.max(0, unmatched.length - there.length);
    const slots = ceilingSlots(options.room.polygon, features.length);
    for (const at of [...matchedAt, ...there]) {
      if (slots.length === 0) break;
      const gaps = slots.map((s) => Math.hypot(s.x - at.x, s.y - at.y));
      slots.splice(gaps.indexOf(Math.min(...gaps)), 1);
    }
    slots.slice(0, fresh).forEach((slot, i) => {
      const feature = unmatched[i]!;
      const at = { x: cm(slot.x), y: cm(slot.y) };
      const payload = basePayload(
        type,
        feature,
        { kind: 'ceiling', roomId: options.room.id, at },
        options,
        newId,
      );
      drafts.push(deviceDraft(payload, feature.confidence, true, newId));
    });
  }
  return drafts;
}

/**
 * Whether measurements contradict the model's value: their mean differs by more than `tolerance`,
 * and each one on its own by more than `OPENING_TOLERANCE` in the same direction.
 */
function contradicts(values: readonly number[], model: number, tolerance: number): boolean {
  if (values.length === 0) return false;
  const delta = mean(values) - model;
  return (
    Math.abs(delta) > tolerance &&
    values.every(
      (v) => Math.abs(v - model) > OPENING_TOLERANCE && Math.sign(v - model) === Math.sign(delta),
    )
  );
}

interface OpeningSizes {
  /** Per observed edge pair: top and bottom for widths, left and right for heights. */
  widths: number[];
  heights: number[];
  /** `u` of the opening's end nearer `a`, per width pair. */
  starts: number[];
}

function openingSizes(wall: WallFit, index: number, homography: Homography): OpeningSizes {
  const corners = new Map<string, XY>();
  for (const r of wall.refs) {
    if (r.ref.opening !== index) continue;
    const p = applyHomography(homography, r.image);
    if (p) corners.set(r.ref.corner, p);
  }
  const pairs = (a: string, b: string) => {
    const p = corners.get(a);
    const q = corners.get(b);
    return p && q ? [[p, q] as const] : [];
  };
  const across = [...pairs('top_left', 'top_right'), ...pairs('bottom_left', 'bottom_right')];
  const upright = [...pairs('top_left', 'bottom_left'), ...pairs('top_right', 'bottom_right')];
  return {
    widths: across.map(([l, r]) => Math.abs(r.x - l.x)),
    heights: upright.map(([t, b]) => t.y - b.y),
    starts: across.map(([l, r]) => Math.min(l.x, r.x)),
  };
}

/** Jackknife standard error of `measure` over fits that each leave one of `refs` out. */
function jackknife(refs: readonly Located[], measure: (fit: Fit) => number | null): number {
  const values = refs.flatMap((_, i) => {
    const fit = fitOf(refs.filter((_, j) => j !== i));
    const value = fit ? measure(fit) : null;
    return value === null ? [] : [value];
  });
  if (values.length < 2) return Infinity;
  const m = mean(values);
  return Math.sqrt(
    ((values.length - 1) / values.length) * values.reduce((s, v) => s + (v - m) ** 2, 0),
  );
}

/**
 * One opening, measured with a fit from its wall's other references (its own corners would pull
 * the fit towards the model's size), also leaving out the openings in `excluded`. A difference
 * counts when it stands out from the noise of the opening's own two corners (`sigma` each) and
 * from how much the fit itself moves when any one of its points is left out.
 */
type Measured = { correction: OpeningPayload; score: number } | 'agrees' | 'unmeasurable';

function measureOpening(
  options: PhotoSuggestOptions,
  fits: readonly WallFit[],
  index: number,
  excluded: ReadonlySet<number>,
): Measured {
  const opening = options.openings[index]!;
  const wall = fits[options.walls.findIndex((w) => w.id === opening.wallId)];
  if (!wall) return 'unmeasurable';
  const refs = withoutOpenings(wall, new Set([...excluded, index]));
  const fit = checkFit(refs);
  if (!fit) return 'unmeasurable';
  const sizes = openingSizes(wall, index, fit.homography);
  if (sizes.widths.length === 0 && sizes.heights.length === 0) return 'unmeasurable';
  const tolerance = (values: (s: OpeningSizes) => number[]) => {
    const spread = jackknife(refs, (f) => {
      const v = values(openingSizes(wall, index, f.homography));
      return v.length > 0 ? mean(v) : null;
    });
    // Each value is two corners apart; their mean over k independent pairs varies by 2σ²/k.
    const own = (2 * fit.sigma ** 2) / values(sizes).length;
    return Math.max(OPENING_TOLERANCE, 3 * Math.sqrt(own + spread ** 2));
  };
  const correction = { ...opening };
  let score = 0;
  if (sizes.widths.length > 0) {
    const limit = tolerance((s) => s.widths);
    if (contradicts(sizes.widths, opening.width, limit)) {
      const width = mean(sizes.widths);
      correction.width = cm(width);
      correction.offset = cm(clamp(mean(sizes.starts), 0, Math.max(0, wall.frame.length - width)));
      score = Math.abs(width - opening.width) / limit;
    }
  }
  if (sizes.heights.length > 0) {
    const limit = tolerance((s) => s.heights);
    const height = mean(sizes.heights);
    if (height > 0 && contradicts(sizes.heights, opening.height, limit)) {
      correction.height = cm(height);
      score = Math.max(score, Math.abs(height - opening.height) / limit);
    }
  }
  return score > 0 ? { correction, score } : 'agrees';
}

/**
 * Opening corrections by opening index. The most contradicted opening is taken first, and the rest
 * are measured again without its corners, so one wrong opening does not skew another. The result
 * stands only where it is not ambiguous: every other opening seen on that wall must then measure as
 * agreeing (with two openings and only the floor corners, either one could be the wrong one), and
 * each correction is measured again without all the other contradicted openings.
 */
function openingCorrections(
  options: PhotoSuggestOptions,
  fits: readonly WallFit[],
): {
  found: Map<number, OpeningPayload>;
  contradicted: ReadonlySet<number>;
  ambiguous: ReadonlySet<Id>;
} {
  const contradicted = new Set<number>();
  for (;;) {
    let best: { index: number; score: number } | null = null;
    for (const index of options.openings.keys()) {
      if (contradicted.has(index)) continue;
      const measured = measureOpening(options, fits, index, contradicted);
      if (typeof measured === 'object' && (!best || measured.score > best.score))
        best = { index, score: measured.score };
    }
    if (!best) break;
    contradicted.add(best.index);
  }

  const wallOf = (index: number) => options.openings[index]!.wallId;
  const seen = new Set(fits.flatMap((f) => f.fitRefs.flatMap((r) => r.ref.opening ?? [])));
  const ambiguous = new Set(
    [...seen]
      .filter((j) => !contradicted.has(j))
      .filter((j) => measureOpening(options, fits, j, contradicted) === 'unmeasurable')
      .map(wallOf),
  );
  const found = new Map<number, OpeningPayload>();
  for (const index of contradicted) {
    if (ambiguous.has(wallOf(index))) continue;
    const others = new Set([...contradicted].filter((j) => j !== index));
    const measured = measureOpening(options, fits, index, others);
    if (typeof measured === 'object') found.set(index, measured.correction);
  }
  return { found, contradicted, ambiguous };
}

/**
 * The ceiling height from the top wall corners, through fits without contradicted openings and
 * not on walls whose openings are ambiguous: at least two corners that agree with each other,
 * differing from the room's by more than the tolerance and three times the fits' residual.
 */
function ceilingCorrection(
  options: PhotoSuggestOptions,
  fits: readonly WallFit[],
  openings: ReturnType<typeof openingCorrections>,
  newId: () => Id,
): SuggestionDraft[] {
  const { room } = options;
  if (options.pendingCorrections.roomIds.includes(room.id)) return [];
  const { contradicted, ambiguous } = openings;
  const measured = fits.flatMap((wall, i) => {
    if (ambiguous.has(options.walls[i]!.id)) return [];
    const fit = checkFit(withoutOpenings(wall, contradicted));
    if (!fit) return [];
    return wall.refs.flatMap((r) => {
      const p = r.ref.ceiling ? applyHomography(fit.homography, r.image) : null;
      return p ? [{ v: p.y, sigma: fit.sigma }] : [];
    });
  });
  if (measured.length < 2) return [];
  const values = measured.map((m) => m.v);
  if (Math.max(...values) - Math.min(...values) > CEILING_AGREEMENT) return [];
  const height = mean(values);
  const tolerance = Math.max(CEILING_TOLERANCE, 3 * Math.max(...measured.map((m) => m.sigma)));
  if (
    Math.abs(height - room.ceilingHeight) <= tolerance ||
    height < CEILING_RANGE.min ||
    height > CEILING_RANGE.max
  )
    return [];
  return [
    {
      id: newId(),
      kind: 'room-ceiling-height',
      payload: { roomId: room.id, ceilingHeight: cm(height) },
      issues: [],
      requires: [],
    },
  ];
}

/**
 * Decision 5: wall features placed through a homography fitted per wall from its references (or
 * roughly without a trustworthy one), ceiling lights in the room, de-duplicated against the room's
 * devices and the pending suggestions, plus opening and ceiling-height corrections that stand out
 * from the fit's own noise and are not already pending.
 */
export function interpretPhoto(
  output: PhotoOutput,
  options: PhotoSuggestOptions,
  newId: () => Id,
): SuggestionDraft[] {
  const types = new Map(options.detectable.map((d) => [deviceTypeKey(d), d]));
  const fits = wallFits(output, options);
  const corrections = openingCorrections(options, fits);
  const pendingOpenings = new Set(options.pendingCorrections.openingIds);
  const openingDrafts = [...corrections.found.values()]
    .filter((payload) => !pendingOpenings.has(payload.id))
    .map((payload): SuggestionDraft => ({
      id: newId(),
      kind: 'opening',
      payload,
      issues: [],
      requires: [],
    }));
  return [
    ...wallDevices(output, options, fits, types, newId),
    ...ceilingDevices(output, options, types, newId),
    ...openingDrafts,
    ...ceilingCorrection(options, fits, corrections, newId),
  ];
}
