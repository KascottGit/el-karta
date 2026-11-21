import type { FloorData, Opening, Provenance, Room, Wall } from '@el-karta/core';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Facit, floorToFacit, FullFacit, Manifest } from '../floorplan/facit.ts';

const dir = join(import.meta.dirname, '../floorplan');
const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

describe('the committed facit', () => {
  it('has a facit file for every manifest plan, and each parses', async () => {
    const manifest = Manifest.parse(await json(join(dir, 'manifest.json')));
    const files = await readdir(join(dir, 'facit'));
    expect(files.sort()).toEqual(manifest.plans.map((p) => `${p.id}.json`).sort());
    for (const plan of manifest.plans) {
      const facit = Facit.parse(await json(join(dir, 'facit', `${plan.id}.json`)));
      expect(facit.id).toBe(plan.id);
    }
  });
});

describe('floorToFacit', () => {
  const provenance: Provenance = { status: 'confirmed', source: 'user' };
  const wall = (id: string, a: Wall['a'], b: Wall['b']): Wall => ({
    id,
    a,
    b,
    thickness: 0.1,
    provenance,
  });
  // The image is placed at (10, 5), turned 90° clockwise, at 1 cm per pixel.
  const placed = (p: { x: number; y: number }) => ({ x: 10 - p.y, y: 5 + p.x });
  const walls = {
    w1: wall('w1', placed({ x: 0, y: 0 }), placed({ x: 4, y: 0 })),
    w2: wall('w2', placed({ x: 4, y: 0 }), placed({ x: 4, y: 3 })),
  };
  const door: Opening = {
    id: 'o1',
    wallId: 'w2',
    kind: 'door',
    offset: 1,
    width: 0.9,
    height: 2.1,
    provenance,
  };
  const room = (name: string): Room => ({
    id: name || 'unnamed',
    name,
    type: 'bedroom',
    polygon: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ].map(placed),
    provenance,
  });
  const floor: Pick<FloorData, 'walls' | 'openings' | 'rooms' | 'background' | 'scale'> = {
    walls,
    openings: { o1: door },
    rooms: { r1: room('Sovrum'), r2: room('  ') },
    background: { attachmentId: 'a', offset: { x: 10, y: 5 }, rotation: 90 },
    scale: { source: 'user', metresPerPixel: 0.01 },
  };

  it('moves the floor into the image frame and counts doors and windows', () => {
    const facit = floorToFacit({ id: 'plan', floor, image: { width: 2000, height: 1500 } })!;
    expect(FullFacit.parse(facit)).toEqual(facit);
    expect(facit.scale.metresPerImageWidth).toBe(20);
    expect(facit.rotationDeg).toBe(0);
    expect(facit.walls[0]).toEqual({ a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.1 });
    expect(facit.openings).toEqual([{ kind: 'door', offset: 1, width: 0.9, wall: 1 }]);
    expect(facit.rooms.map((r) => [r.name, r.types, r.area])).toEqual([
      ['Sovrum', ['bedroom'], 12],
      [null, ['bedroom'], 12],
    ]);
    expect(facit).toMatchObject({ doors: 1, windows: 0, level: 'full' });
  });

  it('refuses a floor without a background or a scale', () => {
    const image = { width: 100, height: 100 };
    const { scale, background, ...rest } = floor;
    expect(floorToFacit({ id: 'p', floor: { ...rest, background }, image })).toBeNull();
    expect(floorToFacit({ id: 'p', floor: { ...rest, scale }, image })).toBeNull();
  });
});
