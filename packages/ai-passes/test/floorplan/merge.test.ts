import { describe, expect, it } from 'vitest';
import {
  interpretFloorplan,
  mergeFloorplanTiles,
  outputToPixels,
  planTiles,
  tilesBounds,
  type FloorplanOutput,
  type Tile,
  type TileOutput,
} from '../../src/index.ts';
import { cutTile, idSource, optionsFor, output, testPlan } from './fixtures.ts';

describe('mergeFloorplanTiles', () => {
  const plan = testPlan();
  const full = {
    ...plan.output,
    scaleText: '1:100',
    standardObjects: [
      { type: 'wardrobe' as const, a: plan.norm({ x: 4, y: 2 }), b: plan.norm({ x: 4.6, y: 2 }) },
    ],
  };
  const px = outputToPixels(full, plan.frame);
  // Left and right halves sharing plan x 2.5–5.5 m, where the inner wall and its door lie.
  const tiles: Tile[] = [
    { x: 0, y: 0, width: 850, height: 1200 },
    { x: 550, y: 0, width: 850, height: 1200 },
  ];
  const parts: TileOutput<FloorplanOutput>[] = tiles.map((tile) => ({
    tile,
    output: cutTile(px, tile),
  }));

  it('sees the shared items in both tiles before merging', () => {
    const doorsAtInnerWall = parts.map(
      (p) => p.output.openings.filter((o) => Math.abs(o.a.x - o.b.x) < 5).length,
    );
    expect(doorsAtInnerWall).toEqual([1, 1]);
    expect(parts.map((p) => p.output.standardObjects.length)).toEqual([1, 1]);
  });

  it('keeps each opening, label and object once', () => {
    const merged = mergeFloorplanTiles(parts);
    expect(merged.openings).toHaveLength(4);
    expect(merged.rooms.map((r) => r.name).sort()).toEqual(['Sovrum', 'Vardagsrum', 'WC/D']);
    expect(merged.standardObjects).toHaveLength(1);
    expect(merged.scaleText).toBe('1:100');
  });

  it('gives the same suggestions as the untiled plan', () => {
    const merged = mergeFloorplanTiles(parts);
    const frame = tilesBounds(tiles);
    const tiled = interpretFloorplan(merged, { ...optionsFor(plan), frame }, idSource()).drafts;
    const whole = interpretFloorplan(full, optionsFor(plan), idSource()).drafts;
    const count = (drafts: typeof whole, kind: string) =>
      drafts.filter((d) => d.kind === kind).length;
    for (const kind of ['wall', 'opening', 'room'])
      expect(count(tiled, kind)).toBe(count(whole, kind));
    expect(count(tiled, 'wall')).toBe(6);
    const areas = (drafts: typeof whole) =>
      drafts
        .filter((d) => d.kind === 'room')
        .map((d) => (d.payload as { name: string }).name)
        .sort();
    expect(areas(tiled)).toEqual(areas(whole));
  });

  it('normalises the merged output to the bounds of the tiles', () => {
    const offset: Tile[] = [
      { x: 100, y: 50, width: 500, height: 400 },
      { x: 500, y: 50, width: 500, height: 400 },
    ];
    const wall = (x0: number, x1: number) => ({
      a: { x: x0, y: 500 },
      b: { x: x1, y: 500 },
      exterior: true,
      thickness: 10,
    });
    const merged = mergeFloorplanTiles([
      { tile: offset[0]!, output: output({ walls: [wall(100, 1000)] }) },
      { tile: offset[1]!, output: output({ walls: [wall(0, 600)] }) },
    ]);
    expect(merged.walls).toHaveLength(1);
    // Full-image x 150–800 on the 900 px wide bounds starting at x = 100.
    expect(merged.walls[0]!.a.x).toBeCloseTo((50 / 900) * 1000, 6);
    expect(merged.walls[0]!.b.x).toBeCloseTo((700 / 900) * 1000, 6);
    expect(merged.walls[0]!.thickness).toBeCloseTo((5 / 900) * 1000, 6);
  });
});

describe('planTiles', () => {
  it('is one tile when the image fits', () => {
    expect(planTiles(1800, 1200)).toEqual([{ x: 0, y: 0, width: 1800, height: 1200 }]);
  });

  it('cuts a large image into overlapping tiles no larger than maxSide that cover it', () => {
    const tiles = planTiles(4961, 3508);
    expect(tiles).toHaveLength(3 * 2);
    for (const t of tiles) {
      expect(t.width).toBeLessThanOrEqual(2000);
      expect(t.height).toBeLessThanOrEqual(2000);
    }
    expect(tilesBounds(tiles)).toEqual({ x: 0, y: 0, width: 4961, height: 3508 });
    const row = tiles.filter((t) => t.y === 0).sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const overlap = row[i - 1]!.x + row[i - 1]!.width - row[i]!.x;
      expect(overlap / row[i]!.width).toBeGreaterThanOrEqual(0.149);
    }
  });

  it('takes other sizes and overlaps', () => {
    const tiles = planTiles(3000, 1000, { maxSide: 1000, overlap: 0 });
    expect(tiles.map((t) => [t.x, t.width])).toEqual([
      [0, 1000],
      [1000, 1000],
      [2000, 1000],
    ]);
  });
});
