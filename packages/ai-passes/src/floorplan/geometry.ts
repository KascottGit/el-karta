import {
  add,
  distance,
  dot,
  EPSILON,
  faceAt,
  imageToWorld,
  leftNormal,
  nearestWall,
  normalize,
  scale,
  signedArea,
  sub,
  wallFaces,
  type BackgroundPlacement,
  type Opening,
  type Pt,
  type Wall,
  type WallFace,
} from '@el-karta/core';
import type { DetectedRoom, FloorplanOutput } from './schema.ts';
import { cleanWalls, type CleanWall, type Segment } from './walls.ts';

/** Wall thickness in metres when the model gives none or an implausible one. */
export const WALL_THICKNESS = { exterior: 0.3, interior: 0.12, min: 0.05, max: 0.6 } as const;

/** An opening is placed on a parallel wall whose face is at most this far away, in metres. */
export const OPENING_REACH = 0.3;

/** Openings of one kind on one wall this close together are one opening (double doors). */
const DOUBLE_GAP = 0.15;

/** Same sizes as the editor's defaults for new openings. */
export const OPENING_SIZE = {
  door: { height: 2.1 },
  window: { height: 1.2, sill: 0.9 },
  passage: { height: 2.1 },
} as const;

/** A room whose walls do not close gets a square this many metres wide without a box from the model. */
const OPEN_ROOM_SIDE = 2;

/** Room fill joins wall ends this close; cleaned walls meet exactly, so it only absorbs rounding. */
const FILL_TOLERANCE = 0.02;

export type PlannedOpening = Omit<Opening, 'id' | 'provenance'> & {
  double: boolean;
  /** How far the detected opening was from the wall's centreline, in metres. */
  distance: number;
  /** How far the detected opening was moved to fit inside the wall, in metres. */
  clamped: number;
};

export interface PlannedRoom {
  labels: DetectedRoom[];
  polygon: Pt[];
  /** False when the walls around the label do not close and `polygon` is the model's rough extent. */
  filled: boolean;
  /** Floor area inside the walls in m², approximated from the centreline polygon; null when not filled. */
  netArea: number | null;
  /** The sum of the labels' printed areas, or null unless every label has one. */
  printedArea: number | null;
  /** Every label is outdoor (a balcony or terrace). */
  outdoor: boolean;
}

/** The floor geometry read off one output, before ids and suggestions. Wall keys are local. */
export interface PlannedGeometry {
  walls: Record<string, Wall & { joined: CleanWall['joined'] }>;
  openings: PlannedOpening[];
  rooms: PlannedRoom[];
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function wallThickness(pixels: number | null, exterior: boolean, metresPerPixel: number) {
  const fallback = exterior ? WALL_THICKNESS.exterior : WALL_THICKNESS.interior;
  if (pixels === null || !(pixels > 0)) return fallback;
  return clamp(pixels * metresPerPixel, WALL_THICKNESS.min, WALL_THICKNESS.max);
}

const round = (p: Pt): Pt => ({
  x: Math.round(p.x * 1000) / 1000,
  y: Math.round(p.y * 1000) / 1000,
});

interface DetectedOpeningWorld {
  kind: Opening['kind'];
  a: Pt;
  b: Pt;
  double: boolean;
  hinge: 'a' | 'b' | null;
  swingInto: Pt | null;
}

/**
 * Projects an opening onto the nearest roughly parallel wall and clamps it inside the wall. The
 * hinge and swing follow ADR 0006, relative to that wall's a→b direction.
 */
export function placeDetectedOpening(
  walls: Readonly<Record<string, Wall>>,
  o: DetectedOpeningWorld,
  reach = OPENING_REACH,
): PlannedOpening | null {
  const dir = normalize(sub(o.b, o.a));
  const parallel: Record<string, Wall> = {};
  for (const [key, wall] of Object.entries(walls)) {
    const wallDir = normalize(sub(wall.b, wall.a));
    if (Math.abs(dot(dir, wallDir)) >= Math.cos((20 * Math.PI) / 180)) parallel[key] = wall;
  }
  const mid = scale(add(o.a, o.b), 0.5);
  const hit = nearestWall({ walls: parallel }, mid, reach);
  if (!hit) return null;
  const wall = walls[hit.wallId]!;
  const wallDir = normalize(sub(wall.b, wall.a));
  const ta = dot(sub(o.a, wall.a), wallDir);
  const tb = dot(sub(o.b, wall.a), wallDir);
  const width = Math.min(Math.abs(tb - ta), hit.length);
  if (width < EPSILON) return null;
  const start = Math.min(ta, tb);
  const offset = clamp(start, 0, hit.length - width);
  const size = OPENING_SIZE[o.kind];
  const planned: PlannedOpening = {
    wallId: hit.wallId,
    kind: o.kind,
    offset,
    width,
    height: size.height,
    double: o.double,
    distance: hit.distance,
    clamped: Math.abs(offset - start) + (Math.abs(tb - ta) - width),
  };
  if ('sill' in size) planned.sill = size.sill;
  if (o.kind === 'door') {
    if (o.hinge && !o.double) {
      planned.hinge = (o.hinge === 'a') === ta <= tb ? 'left' : 'right';
    }
    if (o.swingInto)
      planned.swing = dot(sub(o.swingInto, wall.a), leftNormal(wallDir)) >= 0 ? 'in' : 'out';
  }
  return planned;
}

/** Joins openings of the same kind that touch on the same wall, such as two leaves of a balcony door. */
export function joinDoubleOpenings(openings: readonly PlannedOpening[]): PlannedOpening[] {
  const sorted = [...openings].sort((p, q) =>
    p.wallId === q.wallId ? p.offset - q.offset : p.wallId < q.wallId ? -1 : 1,
  );
  const out: PlannedOpening[] = [];
  for (const o of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.wallId === o.wallId &&
      prev.kind === o.kind &&
      o.offset <= prev.offset + prev.width + DOUBLE_GAP
    ) {
      const end = Math.max(prev.offset + prev.width, o.offset + o.width);
      const joined: PlannedOpening = {
        ...prev,
        width: end - prev.offset,
        double: true,
        distance: Math.max(prev.distance, o.distance),
        clamped: prev.clamped + o.clamped,
      };
      // Each leaf of a double door has its own hinge, which one opening cannot describe.
      delete joined.hinge;
      out[out.length - 1] = joined;
    } else out.push(o);
  }
  return out;
}

function perimeter(polygon: readonly Pt[]) {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++)
    sum += distance(polygon[i]!, polygon[(i + 1) % polygon.length]!);
  return sum;
}

function roughPolygon(room: DetectedRoom, placement: BackgroundPlacement): Pt[] {
  const box = room.box;
  if (box && box.xmax > box.xmin && box.ymax > box.ymin) {
    return [
      { x: box.xmin, y: box.ymin },
      { x: box.xmax, y: box.ymin },
      { x: box.xmax, y: box.ymax },
      { x: box.xmin, y: box.ymax },
    ].map((p) => round(imageToWorld(placement, p)));
  }
  const c = imageToWorld(placement, room.point);
  const h = OPEN_ROOM_SIDE / 2;
  return [
    { x: c.x - h, y: c.y - h },
    { x: c.x + h, y: c.y - h },
    { x: c.x + h, y: c.y + h },
    { x: c.x - h, y: c.y + h },
  ].map(round);
}

/**
 * Decision 1's deterministic geometry for an output in full-image pixels: walls in metres through
 * the placement, cleaned; openings on their walls; rooms filled from their label points, grouped
 * when several labels share one enclosed area.
 */
export function planGeometry(px: FloorplanOutput, placement: BackgroundPlacement): PlannedGeometry {
  const k = placement.metresPerPixel;
  const world = (p: Pt) => imageToWorld(placement, p);
  const segments: Segment[] = px.walls.map((w) => ({
    a: world(w.a),
    b: world(w.b),
    thickness: wallThickness(w.thickness, w.exterior, k),
    exterior: w.exterior,
  }));
  const detected: DetectedOpeningWorld[] = px.openings.map((o) => ({
    ...o,
    a: world(o.a),
    b: world(o.b),
    swingInto: o.swingInto && world(o.swingInto),
  }));
  const walls: PlannedGeometry['walls'] = {};
  cleanWalls(segments, detected, (placement.rotation * Math.PI) / 180).forEach((w, i) => {
    walls[`w${i}`] = {
      id: `w${i}`,
      a: round(w.a),
      b: round(w.b),
      thickness: Math.round(w.thickness * 1000) / 1000,
      joined: w.joined,
      provenance: { status: 'suggested' },
    };
  });

  const openings = joinDoubleOpenings(
    detected.flatMap((o) => placeDetectedOpening(walls, o) ?? []),
  );

  const faces = wallFaces(walls, FILL_TOLERANCE);
  const halfThickness =
    Object.values(walls).reduce((s, w) => s + w.thickness, 0) /
    Math.max(1, Object.keys(walls).length) /
    2;
  const byFace = new Map<WallFace, PlannedRoom>();
  const rooms: PlannedRoom[] = [];
  for (const label of px.rooms) {
    const face = faceAt(faces, world(label.point));
    const shared = face && byFace.get(face);
    if (shared) {
      shared.labels.push(label);
      shared.printedArea =
        shared.printedArea === null || label.area === null ? null : shared.printedArea + label.area;
      shared.outdoor &&= label.outdoor;
      continue;
    }
    if (!face) {
      rooms.push({
        labels: [label],
        polygon: roughPolygon(label, placement),
        filled: false,
        netArea: null,
        printedArea: label.area,
        outdoor: label.outdoor,
      });
      continue;
    }
    const polygon = face.polygon.map(round);
    // The centreline polygon includes half of each surrounding wall; printed areas do not.
    const netArea = Math.max(0, Math.abs(signedArea(polygon)) - perimeter(polygon) * halfThickness);
    const room: PlannedRoom = {
      labels: [label],
      polygon,
      filled: true,
      netArea,
      printedArea: label.area,
      outdoor: label.outdoor,
    };
    byFace.set(face, room);
    rooms.push(room);
  }
  return { walls, openings, rooms };
}
