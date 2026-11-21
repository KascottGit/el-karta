import type { Pt } from '@el-karta/core';
import type { Tile } from '../pass.ts';
import type { FloorplanOutput, NormBox, NormPoint } from './schema.ts';

export const NORM = 1000;

/** A normalised point on the image of `frame` → pixels of the full image. */
export const toPixels = (frame: Tile, p: NormPoint): Pt => ({
  x: frame.x + (p.x / NORM) * frame.width,
  y: frame.y + (p.y / NORM) * frame.height,
});

export const toNorm = (frame: Tile, p: Pt): NormPoint => ({
  x: ((p.x - frame.x) / frame.width) * NORM,
  y: ((p.y - frame.y) / frame.height) * NORM,
});

const mapBox = (box: NormBox, f: (p: Pt) => Pt): NormBox => {
  const min = f({ x: box.xmin, y: box.ymin });
  const max = f({ x: box.xmax, y: box.ymax });
  return { xmin: min.x, ymin: min.y, xmax: max.x, ymax: max.y };
};

/**
 * The same detections with every point mapped by `point` and every wall thickness by `length`.
 * Points stay `{ x, y }`, so a `FloorplanOutput` in full-image pixels has the same type.
 */
export function mapFloorplan(
  output: FloorplanOutput,
  point: (p: Pt) => Pt,
  length: (t: number) => number,
): FloorplanOutput {
  return {
    ...output,
    walls: output.walls.map((w) => ({
      ...w,
      a: point(w.a),
      b: point(w.b),
      thickness: w.thickness === null ? null : length(w.thickness),
    })),
    openings: output.openings.map((o) => ({
      ...o,
      a: point(o.a),
      b: point(o.b),
      swingInto: o.swingInto && point(o.swingInto),
    })),
    rooms: output.rooms.map((r) => ({
      ...r,
      point: point(r.point),
      box: r.box && mapBox(r.box, point),
    })),
    dimensions: output.dimensions.map((d) => ({ ...d, a: point(d.a), b: point(d.b) })),
    scaleBar: output.scaleBar && {
      ...output.scaleBar,
      ticks: output.scaleBar.ticks.map((t) => ({ ...t, point: point(t.point) })),
    },
    standardObjects: output.standardObjects.map((o) => ({ ...o, a: point(o.a), b: point(o.b) })),
  };
}

/** Normalised coordinates of the image of `frame` → pixels of the full image (thickness by width). */
export const outputToPixels = (output: FloorplanOutput, frame: Tile): FloorplanOutput =>
  mapFloorplan(
    output,
    (p) => toPixels(frame, p),
    (t) => (t / NORM) * frame.width,
  );

export const outputToNorm = (output: FloorplanOutput, frame: Tile): FloorplanOutput =>
  mapFloorplan(
    output,
    (p) => toNorm(frame, p),
    (t) => (t / frame.width) * NORM,
  );

export const clampNorm = (p: NormPoint): NormPoint => ({
  x: Math.min(NORM, Math.max(0, p.x)),
  y: Math.min(NORM, Math.max(0, p.y)),
});

/** The smallest rectangle around all tiles: the frame a merged output is normalised to. */
export function tilesBounds(tiles: readonly Tile[]): Tile {
  if (tiles.length === 0) throw new Error('tilesBounds needs at least one tile');
  const x = Math.min(...tiles.map((t) => t.x));
  const y = Math.min(...tiles.map((t) => t.y));
  const right = Math.max(...tiles.map((t) => t.x + t.width));
  const bottom = Math.max(...tiles.map((t) => t.y + t.height));
  return { x, y, width: right - x, height: bottom - y };
}
