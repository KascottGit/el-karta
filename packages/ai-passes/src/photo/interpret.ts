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
  fitHomography,
  MIN_FIT_POINTS,
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
 * photo's attachment id (the evidence every device gets) and the device suggestions still pending
 * on the floor, so a second photo of the same wall suggests nothing twice.
 */
export type PhotoSuggestOptions = Omit<PhotoInput, 'image' | 'earlier'> & {
  photoId: Id;
  pending: readonly Pick<Device, 'domain' | 'type' | 'placement'>[];
};

export type DevicePayload = Omit<Device, 'provenance'>;

/** A feature this close along the wall to a device of the same type is that device (decision 5). */
export const DUPLICATE_REACH = 0.3;
/** Openings and the ceiling are only checked with at least this many fit points on the wall. */
export const MIN_CHECK_POINTS = 5;
export const OPENING_TOLERANCE = 0.1;
export const CEILING_TOLERANCE = 0.05;
/** A rough position keeps this share of the model's confidence. */
export const ROUGH_CONFIDENCE = 0.5;
const CEILING_RANGE = { min: 1.8, max: 6 } as const;

const ROUGH: SuggestionIssue = { code: 'photo.position-rough', severity: 'warning' };

const cm = (m: number) => Math.round(m * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const centre = (box: NormBox): XY =>
  clampNorm({ x: (box.xmin + box.xmax) / 2, y: (box.ymin + box.ymax) / 2 });

interface Located {
  ref: PlaneRef;
  image: XY;
}

interface WallFit {
  frame: WallFrame;
  refs: Located[];
  fitRefs: Located[];
  fit: Homography | null;
}

const usable = (r: Located) => r.ref.v !== null && !r.ref.ceiling;
const correspondences = (refs: readonly Located[]) =>
  refs.map((r) => ({ image: r.image, plane: { x: r.ref.u, y: r.ref.v ?? 0 } }));
const fitOf = (refs: readonly Located[]) =>
  refs.length >= MIN_FIT_POINTS ? fitHomography(correspondences(refs)) : null;

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

function wallDuplicate(placed: readonly Placed[], candidate: DevicePayload): boolean {
  const p = candidate.placement;
  if (p.kind !== 'wall') return false;
  return placed.some(
    (d) =>
      d.domain === candidate.domain &&
      d.type === candidate.type &&
      d.placement.kind === 'wall' &&
      d.placement.wallId === p.wallId &&
      d.placement.side === p.side &&
      Math.abs(d.placement.offset - p.offset) <= DUPLICATE_REACH,
  );
}

function wallDevices(
  output: PhotoOutput,
  options: PhotoSuggestOptions,
  fits: readonly WallFit[],
  types: ReadonlyMap<string, PhotoDetectableInput>,
  newId: () => Id,
): SuggestionDraft[] {
  const placed: Placed[] = [...options.devices, ...options.pending];
  const drafts: SuggestionDraft[] = [];
  for (const feature of output.features) {
    const type = types.get(feature.deviceType);
    if (!type || type.placement !== 'wall' || isExisting(feature, options)) continue;
    const index = wallIndex(feature.wall, options.walls.length);
    const wall = index === null ? undefined : options.walls[index];
    const fit = index === null ? undefined : fits[index];
    if (!wall || !fit) continue;
    const point = centre(feature.box);
    const mapped = fit.fit ? applyHomography(fit.fit, point) : null;
    const { frame } = fit;
    const offset = mapped
      ? clamp(mapped.x, frame.start, frame.end)
      : roughOffset(
          fit.refs.map((r) => ({ x: r.image.x, u: r.ref.u })),
          point.x,
          frame,
        );
    const height = mapped
      ? clamp(mapped.y, 0, options.room.ceilingHeight)
      : (type.defaultHeight ?? options.room.ceilingHeight / 2);
    const payload = basePayload(
      type,
      feature,
      { kind: 'wall', wallId: wall.id, offset: cm(offset), height: cm(height), side: wall.side },
      options,
      newId,
    );
    if (wallDuplicate(placed, payload)) continue;
    placed.push(payload);
    drafts.push(deviceDraft(payload, feature.confidence, !mapped, newId));
  }
  return drafts;
}

const isExisting = (feature: PhotoFeature, options: PhotoSuggestOptions) =>
  feature.existing !== null && deviceIndex(feature.existing, options.devices.length) !== null;

/**
 * Ceiling lights are not located from a photo: as many as the photo shows of a type, less those
 * already in the room (in the model or pending), go to the slots on the long axis left free by the
 * ones there, always as rough positions.
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
    const there = [...options.devices, ...options.pending].flatMap((d) =>
      deviceTypeKey(d) === key &&
      d.placement.kind === 'ceiling' &&
      d.placement.roomId === options.room.id
        ? [d.placement.at]
        : [],
    );
    const slots = ceilingSlots(options.room.polygon, features.length);
    for (const at of there) {
      if (slots.length === 0) break;
      const gaps = slots.map((s) => Math.hypot(s.x - at.x, s.y - at.y));
      slots.splice(gaps.indexOf(Math.min(...gaps)), 1);
    }
    const unmatched = features
      .filter((f) => !isExisting(f, options))
      .sort((a, b) => b.confidence - a.confidence);
    slots.forEach((slot, i) => {
      const feature = unmatched[i] ?? features[0]!;
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

const mean = (values: readonly number[]) => values.reduce((s, v) => s + v, 0) / values.length;

/** Opening corrections, by opening index. */
function openingCorrections(
  options: PhotoSuggestOptions,
  fits: readonly WallFit[],
): Map<number, PhotoInput['openings'][number]> {
  const corrections = new Map<number, PhotoInput['openings'][number]>();
  options.openings.forEach((opening, index) => {
    const wall = options.walls.findIndex((w) => w.id === opening.wallId);
    const fit = fits[wall];
    if (!fit?.fit || fit.fitRefs.length < MIN_CHECK_POINTS) return;
    // The opening's own corners would pull the fit towards the model's size, so it is measured
    // with a fit from the other references when they are enough.
    const homography = fitOf(fit.fitRefs.filter((r) => r.ref.opening !== index)) ?? fit.fit;
    const corners = new Map<string, XY>();
    for (const r of fit.refs) {
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
    const correction = { ...opening };
    if (across.length > 0) {
      const width = mean(across.map(([l, r]) => Math.abs(r.x - l.x)));
      if (Math.abs(width - opening.width) > OPENING_TOLERANCE) {
        const from = mean(across.map(([l, r]) => Math.min(l.x, r.x)));
        correction.width = cm(width);
        correction.offset = cm(clamp(from, 0, Math.max(0, fit.frame.length - width)));
      }
    }
    if (upright.length > 0) {
      const height = mean(upright.map(([t, b]) => t.y - b.y));
      if (height > 0 && Math.abs(height - opening.height) > OPENING_TOLERANCE)
        correction.height = cm(height);
    }
    if (correction.width !== opening.width || correction.height !== opening.height)
      corrections.set(index, correction);
  });
  return corrections;
}

/**
 * The ceiling height measured from the top wall corners, on walls with enough fit points whose
 * openings all agree with the photo (a contradicted opening would skew the fit).
 */
function ceilingCorrection(
  options: PhotoSuggestOptions,
  fits: readonly WallFit[],
  contradicted: ReadonlySet<number>,
  newId: () => Id,
): SuggestionDraft[] {
  const measured = fits.flatMap((fit) => {
    if (!fit.fit || fit.fitRefs.length < MIN_CHECK_POINTS) return [];
    if (fit.refs.some((r) => r.ref.opening !== null && contradicted.has(r.ref.opening))) return [];
    const homography = fit.fit;
    return fit.refs.flatMap((r) => {
      const p = r.ref.ceiling ? applyHomography(homography, r.image) : null;
      return p ? [p.y] : [];
    });
  });
  if (measured.length === 0) return [];
  const height = mean(measured);
  const { room } = options;
  if (
    Math.abs(height - room.ceilingHeight) <= CEILING_TOLERANCE ||
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
 * roughly without one), ceiling lights in the room, de-duplicated against the room's devices and
 * the pending suggestions, plus opening and ceiling-height corrections from well-fitted walls.
 */
export function interpretPhoto(
  output: PhotoOutput,
  options: PhotoSuggestOptions,
  newId: () => Id,
): SuggestionDraft[] {
  const types = new Map(options.detectable.map((d) => [deviceTypeKey(d), d]));
  const fits = wallFits(output, options);
  const corrections = openingCorrections(options, fits);
  return [
    ...wallDevices(output, options, fits, types, newId),
    ...ceilingDevices(output, options, types, newId),
    ...[...corrections.values()].map((payload): SuggestionDraft => ({
      id: newId(),
      kind: 'opening',
      payload,
      issues: [],
      requires: [],
    })),
    ...ceilingCorrection(options, fits, new Set(corrections.keys()), newId),
  ];
}
