import { add, cross, distance, normalize, scale, sub, type Pt } from '@el-karta/core';
import type { Tile, TileOutput } from '../pass.ts';
import { clampNorm, mapFloorplan, outputToNorm, outputToPixels, tilesBounds } from './frame.ts';
import { median } from './scale.ts';
import type { DetectedRoom, DetectedWall, FloorplanOutput } from './schema.ts';
import { mergeCollinear } from './walls.ts';

interface Placed<T> {
  item: T;
  part: number;
  /** Distance from the item to the nearest edge its tile shares with another tile; higher is safer. */
  centrality: number;
}

/** Distance from `p` to the edges of `tile` that are cuts, i.e. not on the border of `frame`. */
function centrality(p: Pt, tile: Tile, frame: Tile): number {
  const cuts: number[] = [];
  if (tile.x > frame.x) cuts.push(p.x - tile.x);
  if (tile.y > frame.y) cuts.push(p.y - tile.y);
  if (tile.x + tile.width < frame.x + frame.width) cuts.push(tile.x + tile.width - p.x);
  if (tile.y + tile.height < frame.y + frame.height) cuts.push(tile.y + tile.height - p.y);
  return cuts.length === 0 ? Infinity : Math.min(...cuts);
}

/**
 * Keeps one item of each set of duplicates seen in different tiles: the one furthest from a cut
 * edge, which is the most likely to be whole. `combine` merges what the dropped one adds.
 */
function dedupe<T>(
  items: readonly Placed<T>[],
  same: (a: T, b: T) => boolean,
  combine: (keep: T, drop: T) => T = (keep) => keep,
): T[] {
  const kept: Placed<T>[] = [];
  for (const p of [...items].sort((a, b) => b.centrality - a.centrality)) {
    const index = kept.findIndex((k) => k.part !== p.part && same(k.item, p.item));
    if (index < 0) kept.push(p);
    else kept[index] = { ...kept[index]!, item: combine(kept[index]!.item, p.item) };
  }
  return kept.map((k) => k.item);
}

const mid = (a: Pt, b: Pt) => scale(add(a, b), 0.5);
const parallel = (a: { a: Pt; b: Pt }, b: { a: Pt; b: Pt }) =>
  Math.abs(cross(normalize(sub(a.b, a.a)), normalize(sub(b.b, b.a)))) <
  Math.sin((10 * Math.PI) / 180);

function mode<T>(values: readonly (T | null)[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

const sameName = (a: DetectedRoom, b: DetectedRoom) =>
  a.name.trim().toLowerCase() === b.name.trim().toLowerCase();

/**
 * Decision 6: joins tile outputs into one output normalised to `tilesBounds` of the tiles. Walls cut
 * by a tile edge or seen twice in an overlap are joined; openings, labels, dimensions and objects
 * seen in two tiles are kept once.
 */
export function mergeFloorplanTiles(
  parts: readonly TileOutput<FloorplanOutput>[],
): FloorplanOutput {
  const frame = tilesBounds(parts.map((p) => p.tile));
  const px = parts.map((p) =>
    outputToPixels(
      mapFloorplan(p.output, clampNorm, (t) => t),
      p.tile,
    ),
  );
  const placed = <T>(pick: (o: FloorplanOutput) => readonly T[], at: (item: T) => Pt) =>
    px.flatMap((o, part) =>
      pick(o).map((item) => ({
        item,
        part,
        centrality: centrality(at(item), parts[part]!.tile, frame),
      })),
    );

  const known = px.flatMap((o) =>
    o.walls.flatMap((w) => (w.thickness === null ? [] : [w.thickness])),
  );
  const typical = known.length > 0 ? median(known) : null;
  const tolerance = Math.max(3, (typical ?? 0.004 * Math.max(frame.width, frame.height)) * 0.75);
  const walls: DetectedWall[] = mergeCollinear(
    px.flatMap((o) => o.walls).map((w) => ({ ...w, thickness: w.thickness ?? typical ?? 0 })),
    { collinearAngle: 5, collinearDistance: tolerance, gap: tolerance },
  ).map((w) => ({ ...w, thickness: typical === null ? null : w.thickness }));

  const near = (a: Pt, b: Pt, limit: number) => distance(a, b) <= limit;
  const diagonal = Math.hypot(frame.width, frame.height);

  const openings = dedupe(
    placed(
      (o) => o.openings,
      (o) => mid(o.a, o.b),
    ),
    (a, b) =>
      a.kind === b.kind &&
      parallel(a, b) &&
      near(mid(a.a, a.b), mid(b.a, b.b), Math.max(distance(a.a, a.b), distance(b.a, b.b)) / 2),
  );
  const rooms = dedupe(
    placed(
      (o) => o.rooms,
      (r) => r.point,
    ),
    (a, b) => sameName(a, b) && near(a.point, b.point, Math.max(50, 0.05 * diagonal)),
    (keep, drop) => ({
      ...keep,
      area: keep.area ?? drop.area,
      box:
        keep.box && drop.box
          ? {
              xmin: Math.min(keep.box.xmin, drop.box.xmin),
              ymin: Math.min(keep.box.ymin, drop.box.ymin),
              xmax: Math.max(keep.box.xmax, drop.box.xmax),
              ymax: Math.max(keep.box.ymax, drop.box.ymax),
            }
          : (keep.box ?? drop.box),
    }),
  );
  const endsNear = (a: { a: Pt; b: Pt }, b: { a: Pt; b: Pt }, limit: number) =>
    (near(a.a, b.a, limit) && near(a.b, b.b, limit)) ||
    (near(a.a, b.b, limit) && near(a.b, b.a, limit));
  const dimensions = dedupe(
    placed(
      (o) => o.dimensions,
      (d) => mid(d.a, d.b),
    ),
    (a, b) =>
      a.value === b.value && a.unit === b.unit && endsNear(a, b, Math.max(10, 0.02 * diagonal)),
  );
  const standardObjects = dedupe(
    placed(
      (o) => o.standardObjects,
      (s) => mid(s.a, s.b),
    ),
    (a, b) => a.type === b.type && endsNear(a, b, distance(a.a, a.b) / 2),
  );
  const scaleBar =
    px
      .map((o) => o.scaleBar)
      .reduce<FloorplanOutput['scaleBar']>(
        (best, bar) => (bar && (!best || bar.ticks.length > best.ticks.length) ? bar : best),
        null,
      ) ?? null;

  const merged: FloorplanOutput = {
    walls,
    openings,
    rooms,
    dimensions,
    scaleBar,
    scaleText: mode(px.map((o) => o.scaleText)),
    paperSize: mode(px.map((o) => o.paperSize)),
    totalArea: mode(px.map((o) => o.totalArea)),
    ceilingHeight: mode(px.map((o) => o.ceilingHeight)),
    standardObjects,
  };
  return outputToNorm(merged, frame);
}
