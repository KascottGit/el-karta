import { generateProject, pointOnWall, type FloorRecord, type Pt } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import {
  interpretFloorplan,
  mergeFloorplanTiles,
  outputToPixels,
  planTiles,
  type FloorplanOutput,
} from '../../src/index.ts';
import { cutTile, idSource, output } from './fixtures.ts';

const MPP = 0.01;

/** A floor of the large synthetic project as a model would report it on one image. */
function asOutput(floor: FloorRecord) {
  const { walls, openings, rooms } = floor.data;
  const points = Object.values(walls).flatMap((w) => [w.a, w.b]);
  const minX = Math.min(...points.map((p) => p.x)) - 1;
  const minY = Math.min(...points.map((p) => p.y)) - 1;
  const width = (Math.max(...points.map((p) => p.x)) - minX + 1) / MPP;
  const height = (Math.max(...points.map((p) => p.y)) - minY + 1) / MPP;
  const norm = (p: Pt) => ({
    x: ((p.x - minX) / MPP / width) * 1000,
    y: ((p.y - minY) / MPP / height) * 1000,
  });
  const out: FloorplanOutput = output({
    walls: Object.values(walls).map((w) => ({
      a: norm(w.a),
      b: norm(w.b),
      exterior: w.thickness > 0.2,
      thickness: (w.thickness / MPP / width) * 1000,
    })),
    openings: Object.values(openings).flatMap((o) => {
      const wall = walls[o.wallId];
      if (!wall) return [];
      return [
        {
          kind: o.kind,
          a: norm(pointOnWall(wall, o.offset)),
          b: norm(pointOnWall(wall, o.offset + o.width)),
          double: false,
          hinge: null,
          swingInto: null,
        },
      ];
    }),
    rooms: Object.values(rooms).map((r) => {
      const c = r.polygon.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
      const n = r.polygon.length;
      return {
        name: r.name,
        type: r.type,
        point: norm({ x: c.x / n, y: c.y / n }),
        box: null,
        area: null,
        outdoor: false,
      };
    }),
  });
  return { output: out, width, height };
}

describe('floor-plan pass performance', () => {
  const model = generateProject('large');
  const floor = Object.values(model.floors).reduce((a, b) =>
    Object.keys(b.data.walls).length > Object.keys(a.data.walls).length ? b : a,
  );
  const { output: detected, width, height } = asOutput(floor);
  const frame = { x: 0, y: 0, width, height };
  const options = {
    frame,
    imageSize: { width, height },
    placement: { offset: { x: 0, y: 0 }, rotation: 0, metresPerPixel: MPP },
    existingScale: { source: 'user' as const, metresPerPixel: MPP },
    allowEstimate: false,
  };

  it('interprets the largest floor of the large synthetic project well within a second', () => {
    const start = performance.now();
    const { drafts } = interpretFloorplan(detected, options, idSource());
    const ms = performance.now() - start;
    console.warn(
      `interpret: ${detected.walls.length} walls, ${detected.openings.length} openings, ${detected.rooms.length} rooms → ${drafts.length} drafts in ${ms.toFixed(0)} ms`,
    );
    const rooms = drafts.filter((d) => d.kind === 'room');
    expect(rooms.length).toBe(detected.rooms.length);
    for (const room of rooms) expect(room.issues).toEqual([]);
    expect(ms).toBeLessThan(1000);
  });

  it('merges it from tiles well within a second', () => {
    const tiles = planTiles(width, height, { maxSide: Math.max(width, height) / 2 });
    const px = outputToPixels(detected, frame);
    const parts = tiles.map((tile) => ({ tile, output: cutTile(px, tile) }));
    const start = performance.now();
    const merged = mergeFloorplanTiles(parts);
    const ms = performance.now() - start;
    console.warn(`merge: ${tiles.length} tiles in ${ms.toFixed(0)} ms`);
    expect(merged.rooms).toHaveLength(detected.rooms.length);
    expect(ms).toBeLessThan(1000);
  });
});
