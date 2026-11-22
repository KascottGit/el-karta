import type { Pt } from '@el-karta/core';
import { mapFloorplan, type FloorplanSuggestOptions, type Tile } from '../../src/index.ts';
import type {
  DetectedOpening,
  DetectedRoom,
  DetectedWall,
  FloorplanOutput,
  LocateOutput,
  NormBox,
  PageEvidence,
} from '../../src/floorplan/schema.ts';

/** Page evidence with nothing printed unless given. */
export const page = (partial: Partial<PageEvidence> = {}): PageEvidence => ({
  scaleBar: null,
  scaleText: null,
  paperSize: null,
  totalArea: null,
  ceilingHeight: null,
  ...partial,
});

/** A locate answer: found with `box`, or nothing found when it is null. */
export const located = (
  box: NormBox | null,
  partial: Partial<PageEvidence> = {},
): LocateOutput => ({
  found: box !== null,
  box,
  ...page(partial),
});

/** A hand-written model output: nothing detected unless given. */
export const output = (partial: Partial<FloorplanOutput> = {}): FloorplanOutput => ({
  walls: [],
  openings: [],
  rooms: [],
  dimensions: [],
  ...page(),
  standardObjects: [],
  ...partial,
});

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PlanFixture {
  output: FloorplanOutput;
  frame: Tile;
  imageSize: { width: number; height: number };
  /** Plan metres → full-image pixels. */
  toPx: (p: Pt) => Pt;
  /** Plan metres → the output's normalised coordinates. */
  norm: (p: Pt) => Pt;
  /** Plan metres → world metres under `placement`. */
  toWorld: (p: Pt) => Pt;
  metresPerPixel: number;
}

export interface PlanOptions {
  rotation?: number;
  metresPerPixel?: number;
  /** How sloppy the "model" is: endpoint jitter and corner over/undershoot in metres. */
  jitter?: number;
  overshoot?: number;
  /** Leave out the wall between the bedroom and the bathroom, so neither closes. */
  withoutInnerWall?: boolean;
  seed?: number;
}

/**
 * An 8 × 6 m flat in plan metres: a living room on the left (5 × 6), a bedroom (3 × 3) and a
 * bathroom (3 × 3) on the right, drawn the way a model reads it: endpoints off by a few centimetres,
 * corners overshooting or stopping short, the top wall in two overlapping pieces, the bottom wall
 * broken at the entrance door, and a stray fragment.
 */
export function testPlan(options: PlanOptions = {}): PlanFixture {
  const {
    rotation = 0,
    metresPerPixel = 0.01,
    jitter = 0.04,
    overshoot = 0.12,
    withoutInnerWall = false,
    seed = 1,
  } = options;
  const random = seeded(seed);
  const r = (amount: number) => (random() * 2 - 1) * amount;
  const rad = (rotation * Math.PI) / 180;
  const imageSize = { width: 1400, height: 1200 };
  const centre = { x: 4, y: 3 };
  const toPx = (p: Pt): Pt => {
    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    return {
      x: imageSize.width / 2 + (Math.cos(rad) * dx - Math.sin(rad) * dy) / metresPerPixel,
      y: imageSize.height / 2 + (Math.sin(rad) * dx + Math.cos(rad) * dy) / metresPerPixel,
    };
  };
  const norm = (p: Pt) => {
    const px = toPx(p);
    return { x: (px.x / imageSize.width) * 1000, y: (px.y / imageSize.height) * 1000 };
  };
  const thick = (m: number) => (m / metresPerPixel / imageSize.width) * 1000;

  const sloppy = (a: Pt, b: Pt, exterior: boolean): DetectedWall => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const ea = r(overshoot);
    const eb = r(overshoot);
    return {
      a: norm({ x: a.x - d.x * ea + r(jitter), y: a.y - d.y * ea + r(jitter) }),
      b: norm({ x: b.x + d.x * eb + r(jitter), y: b.y + d.y * eb + r(jitter) }),
      exterior,
      thickness: thick(exterior ? 0.3 : 0.12),
    };
  };
  const walls: DetectedWall[] = [
    sloppy({ x: 0, y: 0 }, { x: 4.6, y: 0 }, true),
    sloppy({ x: 4.3, y: 0 }, { x: 8, y: 0 }, true),
    sloppy({ x: 8, y: 0 }, { x: 8, y: 6 }, true),
    sloppy({ x: 8, y: 6 }, { x: 2, y: 6 }, true),
    sloppy({ x: 1, y: 6 }, { x: 0, y: 6 }, true),
    sloppy({ x: 0, y: 6 }, { x: 0, y: 0 }, true),
    sloppy({ x: 5, y: 0 }, { x: 5, y: 6 }, false),
    ...(withoutInnerWall ? [] : [sloppy({ x: 5, y: 3 }, { x: 8, y: 3 }, false)]),
    // A stray fragment, such as a piece of a fixture read as wall.
    { a: norm({ x: 2, y: 2 }), b: norm({ x: 2.15, y: 2.05 }), exterior: false, thickness: null },
  ];
  const opening = (
    kind: DetectedOpening['kind'],
    a: Pt,
    b: Pt,
    extra: Partial<DetectedOpening> = {},
  ): DetectedOpening => ({
    kind,
    a: norm({ x: a.x + r(jitter), y: a.y + r(jitter) }),
    b: norm({ x: b.x + r(jitter), y: b.y + r(jitter) }),
    double: false,
    hinge: null,
    swingInto: null,
    ...extra,
  });
  const openings: DetectedOpening[] = [
    opening(
      'door',
      { x: 1, y: 6 },
      { x: 2, y: 6 },
      { hinge: 'a', swingInto: norm({ x: 1.5, y: 5.5 }) },
    ),
    opening(
      'door',
      { x: 5, y: 1 },
      { x: 5, y: 1.85 },
      { hinge: 'b', swingInto: norm({ x: 5.5, y: 1.5 }) },
    ),
    opening('door', { x: 6, y: 3 }, { x: 6.8, y: 3 }),
    opening('window', { x: 1.5, y: 0 }, { x: 2.7, y: 0 }),
  ];
  const room = (name: string, type: DetectedRoom['type'], at: Pt, area: number | null) => ({
    name,
    type,
    point: norm(at),
    box: null,
    area,
    outdoor: false,
  });
  const rooms: DetectedRoom[] = [
    room('Vardagsrum', 'living_room', { x: 2.5, y: 3 }, null),
    room('Sovrum', 'bedroom', { x: 6.5, y: 1.5 }, null),
    room('WC/D', 'bathroom', { x: 6.5, y: 4.5 }, null),
  ];
  return {
    output: output({ walls, openings, rooms }),
    frame: { x: 0, y: 0, ...imageSize },
    imageSize,
    toPx,
    norm,
    toWorld: (p) => {
      const px = toPx(p);
      return { x: px.x * metresPerPixel, y: px.y * metresPerPixel };
    },
    metresPerPixel,
  };
}

/** Deterministic UUIDs for drafts. */
export function idSource() {
  let i = 0;
  return () => `00000000-0000-4000-8000-${(i++).toString(16).padStart(12, '0')}`;
}

/** Suggest options for a fixture plan, with its true scale set by the user. */
export const optionsFor = (
  plan: PlanFixture,
  extra: Partial<FloorplanSuggestOptions> = {},
): FloorplanSuggestOptions => ({
  frame: plan.frame,
  imageSize: plan.imageSize,
  placement: { offset: { x: 0, y: 0 }, rotation: 0, metresPerPixel: plan.metresPerPixel },
  existingScale: { source: 'user', metresPerPixel: plan.metresPerPixel },
  allowEstimate: false,
  ...extra,
});

const inside = (p: Pt, t: Tile) =>
  p.x >= t.x && p.x <= t.x + t.width && p.y >= t.y && p.y <= t.y + t.height;

/** Liang–Barsky: the part of segment a–b inside the tile, or null. */
function clip(a: Pt, b: Pt, t: Tile): [Pt, Pt] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: [number, number][] = [
    [-dx, a.x - t.x],
    [dx, t.x + t.width - a.x],
    [-dy, a.y - t.y],
    [dy, t.y + t.height - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
  }
  if (t0 > t1) return null;
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

/** What a model would report for one tile of the full-image detections (in pixels). */
export function cutTile(px: FloorplanOutput, tile: Tile): FloorplanOutput {
  const toTile = (p: Pt): Pt => ({
    x: ((p.x - tile.x) / tile.width) * 1000,
    y: ((p.y - tile.y) / tile.height) * 1000,
  });
  const cut: FloorplanOutput = {
    ...px,
    walls: px.walls.flatMap((w) => {
      const part = clip(w.a, w.b, tile);
      return part ? [{ ...w, a: part[0], b: part[1] }] : [];
    }),
    openings: px.openings.filter((o) => inside(o.a, tile) && inside(o.b, tile)),
    rooms: px.rooms.filter((r) => inside(r.point, tile)),
    dimensions: px.dimensions.filter((d) => inside(d.a, tile) && inside(d.b, tile)),
    standardObjects: px.standardObjects.filter((s) => inside(s.a, tile) && inside(s.b, tile)),
  };
  return mapFloorplan(cut, toTile, (t) => (t / tile.width) * 1000);
}
