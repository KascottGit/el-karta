import type { Id } from '@el-karta/core';
import {
  NORM,
  type ImageCorner,
  type NormBox,
  type NormPoint,
  type PhotoDetectableInput,
  type PhotoFeature,
  type PhotoInput,
  type PhotoOutput,
  type PhotoReference,
  type PhotoSuggestOptions,
  type PhotoWall,
} from '../../src/index.ts';

export const id = (n: number): Id => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Fresh ids from 1000 up, so they never clash with the fixture's own. */
export function ids() {
  let n = 1000;
  return () => id(n++);
}

export const PHOTO = id(99);
export const ROOM = id(1);
export const WALL = { A: id(11), B: id(12), C: id(13), D: id(14) } as const;
export const OPENING = { window: id(21), door: id(22), windowB: id(23) } as const;

const ports = (...kinds: string[]) => kinds.map((kind) => ({ kind, domain: 'power' }));

export const detectable: PhotoDetectableInput[] = [
  {
    domain: 'power',
    type: 'outlet',
    description: 'Wall socket outlet.',
    placement: 'wall',
    defaultHeight: 0.25,
    countable: true,
    ports: ports('power-in'),
  },
  {
    domain: 'power',
    type: 'switch',
    description: 'Light switch.',
    placement: 'wall',
    defaultHeight: 1.05,
    visibleProps: { variant: ['single', 'double', 'dimmer'] },
    ports: ports('power-in', 'control-out'),
  },
  {
    domain: 'power',
    type: 'ceiling_light',
    description: 'Ceiling light.',
    placement: 'ceiling',
    ports: ports('power-in', 'control-in'),
  },
];

const T = 0.1;
const h = T / 2;

/**
 * A 4 × 3 m kitchen (inner faces x 0–4, y 0–3), walls on their centre lines clockwise from the top
 * (A along y = 0). A has a window (1.00–2.20 m from its face's left end, sill 0.90, 1.20 high) and
 * a door (2.95–3.75 m, 2.00 high); B has a window. `reverseA` runs A from its right end to its left,
 * so its room side is `left`.
 */
export function room(
  options: { reverseA?: boolean; ceilingHeight?: number } = {},
): Omit<PhotoInput, 'image' | 'earlier'> {
  const a = { x: -h, y: -h };
  const b = { x: 4 + h, y: -h };
  const wallA: PhotoWall = options.reverseA
    ? { id: WALL.A, a: b, b: a, thickness: T, side: 'left' }
    : { id: WALL.A, a, b, thickness: T, side: 'right' };
  const offsetA = (fromLeft: number, width: number) =>
    options.reverseA ? 4 + h - fromLeft - width : h + fromLeft;
  return {
    room: {
      id: ROOM,
      name: 'Kök',
      type: 'kitchen',
      polygon: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 3 },
        { x: 0, y: 3 },
      ],
      ceilingHeight: options.ceilingHeight ?? 2.5,
    },
    walls: [
      wallA,
      {
        id: WALL.B,
        a: { x: 4 + h, y: -h },
        b: { x: 4 + h, y: 3 + h },
        thickness: T,
        side: 'right',
      },
      {
        id: WALL.C,
        a: { x: 4 + h, y: 3 + h },
        b: { x: -h, y: 3 + h },
        thickness: T,
        side: 'right',
      },
      { id: WALL.D, a: { x: -h, y: 3 + h }, b: { x: -h, y: -h }, thickness: T, side: 'right' },
    ],
    targetWallId: WALL.A,
    openings: [
      {
        id: OPENING.window,
        wallId: WALL.A,
        kind: 'window',
        offset: offsetA(1, 1.2),
        width: 1.2,
        height: 1.2,
        sill: 0.9,
      },
      {
        id: OPENING.door,
        wallId: WALL.A,
        kind: 'door',
        offset: offsetA(2.95, 0.8),
        width: 0.8,
        height: 2,
        hinge: 'left',
      },
      {
        id: OPENING.windowB,
        wallId: WALL.B,
        kind: 'window',
        offset: h + 1,
        width: 1,
        height: 1,
        sill: 1,
      },
    ],
    devices: [],
    detectable,
  };
}

/** Adds a small high window on A, 0.20–0.70 m from its left end (not reversed), as `O4`. */
export function withSmallWindow(context: ReturnType<typeof room>): ReturnType<typeof room> {
  context.openings.push({
    id: id(24),
    wallId: WALL.A,
    kind: 'window',
    offset: h + 0.2,
    width: 0.5,
    height: 0.6,
    sill: 1.3,
  });
  return context;
}

export const input = (context = room()): PhotoInput => ({
  image: { mimeType: 'image/jpeg', data: 'AAAA' },
  earlier: [],
  ...context,
});

export const options = (
  context = room(),
  pending: PhotoSuggestOptions['pending'] = [],
  pendingCorrections: PhotoSuggestOptions['pendingCorrections'] = { openingIds: [], roomIds: [] },
): PhotoSuggestOptions => ({ ...context, photoId: PHOTO, pending, pendingCorrections });

/** A world point: plan x, y and height z. */
export interface P3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A pinhole camera at `at` (eye height `z`), looking along the plan direction `heading` (radians,
 * 0 = +x, plan y down) and pitched by `pitch` (radians, up positive), with a 90° horizontal field
 * of view on a 4:3 image.
 */
export function camera(at: P3, heading: number, pitch: number) {
  const f = {
    x: Math.cos(pitch) * Math.cos(heading),
    y: Math.cos(pitch) * Math.sin(heading),
    z: Math.sin(pitch),
  };
  // Facing +y (down the plan) a viewer's right hand points to −x; plan y is down, z is up.
  const rLen = Math.hypot(f.x, f.y);
  const r = { x: -f.y / rLen, y: f.x / rLen, z: 0 };
  const u = {
    x: r.y * f.z - r.z * f.y,
    y: r.z * f.x - r.x * f.z,
    z: r.x * f.y - r.y * f.x,
  };
  // r × f points up or down depending on handedness; take the one with positive z.
  const up = u.z >= 0 ? u : { x: -u.x, y: -u.y, z: -u.z };
  const width = 4000;
  const height = 3000;
  const focal = width / 2;
  const dot = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z;
  return (p: P3): NormPoint | null => {
    const d = { x: p.x - at.x, y: p.y - at.y, z: p.z - at.z };
    const depth = dot(d, f);
    if (depth <= 0) return null;
    const px = width / 2 + (focal * dot(d, r)) / depth;
    const py = height / 2 - (focal * dot(d, up)) / depth;
    const n = { x: (px / width) * NORM, y: (py / height) * NORM };
    return n.x < 0 || n.x > NORM || n.y < 0 || n.y > NORM ? null : n;
  };
}
export type Camera = ReturnType<typeof camera>;

/** The world point at `u` along a wall from `a` and `v` above the floor, on its room-side face. */
export function onWall(wall: PhotoWall, u: number, v: number): P3 {
  const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
  const dir = { x: (wall.b.x - wall.a.x) / len, y: (wall.b.y - wall.a.y) / len };
  const left = { x: dir.y, y: -dir.x };
  const s = ((wall.side === 'left' ? 1 : -1) * wall.thickness) / 2;
  return { x: wall.a.x + dir.x * u + left.x * s, y: wall.a.y + dir.y * u + left.y * s, z: v };
}

/** A deterministic pseudo-random source (mulberry32). */
export function random(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Adds up to ±`amount` to each coordinate. */
export function jitter(p: NormPoint, amount: number, rand: () => number): NormPoint {
  return { x: p.x + (rand() * 2 - 1) * amount, y: p.y + (rand() * 2 - 1) * amount };
}

export const reference = (
  what: PhotoReference['what'],
  ref: string,
  corner: ImageCorner,
  point: NormPoint,
): PhotoReference => ({ what, ref, corner, point });

export const feature = (partial: Partial<PhotoFeature> & { box: NormBox }): PhotoFeature => ({
  deviceType: 'power.outlet',
  wall: 'A',
  count: null,
  props: [],
  confidence: 0.9,
  existing: null,
  ...partial,
});

export const output = (partial: Partial<PhotoOutput> = {}): PhotoOutput => ({
  wall: 'A',
  references: [],
  features: [],
  ...partial,
});
