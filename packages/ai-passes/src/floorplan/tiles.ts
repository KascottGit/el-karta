import type { Tile } from '../pass.ts';

export interface TileOptions {
  /** Longest side of a tile in pixels. */
  maxSide: number;
  /** Fraction of a tile shared with its neighbour. */
  overlap: number;
}

export const DEFAULT_TILE_OPTIONS: TileOptions = { maxSide: 2000, overlap: 0.15 };

/** Start and length of each tile along one axis of `size` pixels, evenly spread. */
function axis(size: number, { maxSide, overlap }: TileOptions): [number, number][] {
  if (size <= maxSide) return [[0, size]];
  const count = Math.ceil((size - maxSide * overlap) / (maxSide * (1 - overlap)));
  const length = Math.min(maxSide, Math.ceil(size / (count - (count - 1) * overlap)));
  const step = (size - length) / (count - 1);
  return Array.from({ length: count }, (_, i) => [Math.round(i * step), length]);
}

/**
 * How to cut a `width` × `height` image into overlapping tiles no longer than `maxSide` on either
 * side, row by row. An image that already fits is one tile.
 */
export function planTiles(
  width: number,
  height: number,
  options: Partial<TileOptions> = {},
): Tile[] {
  const opts = { ...DEFAULT_TILE_OPTIONS, ...options };
  if (!(opts.overlap >= 0 && opts.overlap < 1)) throw new Error('overlap must be in [0, 1)');
  const tiles: Tile[] = [];
  for (const [y, h] of axis(height, opts)) {
    for (const [x, w] of axis(width, opts)) tiles.push({ x, y, width: w, height: h });
  }
  return tiles;
}
