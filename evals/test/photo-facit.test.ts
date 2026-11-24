import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { photoDetectable } from '../photo/detectable.ts';
import {
  facitProblems,
  parsePhotoFloor,
  PhotoFacit,
  PhotoManifest,
  photoName,
} from '../photo/facit.ts';
import { kitchenFloor, wallFacit } from './photo-fixtures.ts';

const dir = join(import.meta.dirname, '../photo');
const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

describe('the committed photo facit', () => {
  it('has a facit for every manifest photo that parses and fits its floor', async () => {
    const manifest = PhotoManifest.parse(await json(join(dir, 'manifest.json')));
    for (const photo of manifest.photos) {
      const floor = parsePhotoFloor(await json(join(dir, 'floors', `${photo.home}.json`)));
      const facit = PhotoFacit.parse(await json(join(dir, 'facit', `${photoName(photo)}.json`)));
      expect(facitProblems(facit, floor, photoDetectable), photo.file).toEqual([]);
    }
  });
});

describe('the photo facit schemas', () => {
  const sha256 = 'a'.repeat(64);

  it('takes photo names in lower case without spaces, once each', () => {
    const entry = { file: 'villa-kok-1.jpg', sha256, home: 'villa' };
    expect(photoName(entry)).toBe('villa-kok-1');
    expect(PhotoManifest.safeParse({ imagesDir: 'p', photos: [entry] }).success).toBe(true);
    expect(
      PhotoManifest.safeParse({ imagesDir: 'p', photos: [{ ...entry, file: 'Villa kök 1.jpg' }] })
        .success,
    ).toBe(false);
    expect(PhotoManifest.safeParse({ imagesDir: 'p', photos: [entry, entry] }).success).toBe(false);
  });

  it('refuses a ceiling device with an offset, and unknown fields', () => {
    const { ids } = kitchenFloor();
    const facit = wallFacit(ids);
    expect(PhotoFacit.parse(facit)).toEqual(facit);
    const ceiling = { type: 'power.ceiling_light', wall: 'ceiling', offset: 1 };
    expect(PhotoFacit.safeParse({ ...facit, devices: [ceiling] }).success).toBe(false);
    expect(PhotoFacit.safeParse({ ...facit, checked: true }).success).toBe(false);
  });
});

describe('facitProblems', () => {
  const { floor, ids } = kitchenFloor();

  it('accepts a facit that fits its floor', () => {
    expect(facitProblems(wallFacit(ids), floor, photoDetectable)).toEqual([]);
  });

  it('names an unknown room, a wall beside another room, unknown types and wrong places', () => {
    expect(facitProblems({ ...wallFacit(ids), room: ids.window }, floor, photoDetectable)).toEqual([
      `room ${ids.window} is not on the floor`,
    ]);
    const facit: PhotoFacit = {
      ...wallFacit(ids),
      wall: ids.loose,
      devices: [
        { type: 'power.toaster', wall: ids.outer },
        { type: 'power.outlet', wall: 'ceiling' },
        { type: 'power.ceiling_light', wall: ids.outer },
        { type: 'power.outlet', wall: ids.loose },
      ],
    };
    expect(facitProblems(facit, floor, photoDetectable)).toEqual([
      `wall ${ids.loose} does not border the room`,
      'device 1: unknown type power.toaster',
      'device 2: power.outlet goes on the wall',
      'device 3: power.ceiling_light goes on the ceiling',
      `device 4: wall ${ids.loose} does not border the room`,
    ]);
  });

  it('names a room without walls', () => {
    const bare = { ...floor, data: { ...floor.data, walls: {} } };
    expect(facitProblems(wallFacit(ids), bare, photoDetectable)).toEqual([
      `room ${ids.kitchen} has no walls`,
    ]);
  });
});
