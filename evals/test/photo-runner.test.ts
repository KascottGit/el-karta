import { createFakeProvider, ProviderError } from '@el-karta/ai-providers';
import type { FloorRecord } from '@el-karta/core';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { outlet } from '../../packages/ai-passes/test/photo/floor.ts';
import type { PhotoFacit, PhotoManifest } from '../photo/facit.ts';
import { loadPhotoFile } from '../photo/image.ts';
import { PHOTO_COLUMNS, photoEvalChoice, runPhotoEval } from '../photo/run.ts';
import type { PhotoScores } from '../photo/score.ts';
import { kitchenFloor, wallFacit, wallReply } from './photo-fixtures.ts';

/** A 3000 × 2000 JPEG, the size of a phone photo before the app shrinks it. */
async function photoJpeg(width = 3000, height = 2000): Promise<Buffer> {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#c0d0e0';
  context.fillRect(0, 0, width, height);
  return canvas.encode('jpeg', 90);
}

/** `jpeg` with an EXIF block saying it must be turned 90° clockwise to show upright. */
function withExifRotation(jpeg: Buffer): Buffer {
  const entry = Buffer.alloc(12);
  entry.writeUInt16BE(0x0112, 0); // Orientation
  entry.writeUInt16BE(3, 2); // SHORT
  entry.writeUInt32BE(1, 4);
  entry.writeUInt16BE(6, 8); // Rotate 90° clockwise
  const tiff = Buffer.concat([
    Buffer.from('MM\x00\x2a\x00\x00\x00\x08', 'latin1'),
    Buffer.from([0, 1]),
    entry,
    Buffer.alloc(4),
  ]);
  const app1 = Buffer.concat([Buffer.from('Exif\x00\x00', 'latin1'), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(app1.length + 2);
  return Buffer.concat([
    jpeg.subarray(0, 2),
    Buffer.from([0xff, 0xe1]),
    length,
    app1,
    jpeg.subarray(2),
  ]);
}

const sizeOf = async (base64: string) => {
  const image = await loadImage(Buffer.from(base64, 'base64'));
  return [image.width, image.height];
};

let dir: string;
let manifestPath: string;
let resultsDir: string;
let floor: FloorRecord;
let ids: ReturnType<typeof kitchenFloor>['ids'];

interface Shot {
  name: string;
  facit: PhotoFacit;
  data?: Buffer;
  sha?: string;
}

async function setUp(shots: Shot[]) {
  await mkdir(join(dir, 'images'));
  await mkdir(join(dir, 'facit'));
  await mkdir(join(dir, 'floors'));
  const photos: PhotoManifest['photos'] = [];
  for (const shot of shots) {
    const data = shot.data ?? (await photoJpeg());
    await writeFile(join(dir, 'images', `${shot.name}.jpg`), data);
    await writeFile(join(dir, 'facit', `${shot.name}.json`), JSON.stringify(shot.facit));
    const sha256 = shot.sha ?? createHash('sha256').update(data).digest('hex');
    photos.push({ file: `${shot.name}.jpg`, sha256, home: 'villa' });
  }
  await writeFile(join(dir, 'floors', 'villa.json'), JSON.stringify(floor));
  await writeFile(manifestPath, JSON.stringify({ imagesDir: 'images', photos }));
}

const run = (replies: unknown[], options: { photos?: string[]; earlier?: boolean } = {}) => {
  const provider = createFakeProvider(replies);
  const rows = runPhotoEval({
    provider,
    model: 'fake-model',
    manifestPath,
    facitDir: join(dir, 'facit'),
    floorsDir: join(dir, 'floors'),
    resultsDir,
    now: () => new Date('2026-11-24T10:00:00Z'),
    ...options,
  });
  return { provider, rows };
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'el-karta-photo-evals-'));
  manifestPath = join(dir, 'manifest.json');
  resultsDir = join(dir, 'results');
  ({ floor, ids } = kitchenFloor());
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('photoEvalChoice', () => {
  it('defaults to the photo pass primary, and to its model on a named provider', () => {
    expect(photoEvalChoice(undefined, undefined)).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
    });
    expect(photoEvalChoice('gemini', undefined)).toEqual({
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
    });
    expect(() => photoEvalChoice('mistral', undefined)).toThrow(/--model/);
  });
});

describe('loadPhotoFile', () => {
  it('turns a photo upright by its EXIF orientation and shrinks it like the app', async () => {
    const path = join(dir, 'turned.jpg');
    await writeFile(path, withExifRotation(await photoJpeg(3000, 2000)));
    const photo = await loadPhotoFile(path);
    expect([photo.width, photo.height]).toEqual([2000, 3000]);
    expect(await sizeOf(await photo.encode(2048))).toEqual([1365, 2048]);
    // Never enlarged.
    expect(await sizeOf(await photo.encode(4000))).toEqual([2000, 3000]);
  });
});

describe('runPhotoEval', () => {
  it('builds the context as the app does, runs the pass, scores the suggestions and appends a row', async () => {
    // A device already on the floor is left out of the context: the photo must find it.
    const existing = outlet('00000000-0000-4000-8000-000000000501', ids.outer);
    floor.data.devices = { [existing.id]: existing };
    await setUp([{ name: 'villa-kok-1', facit: wallFacit(ids) }]);
    const { provider, rows } = run([wallReply()]);
    const [row] = await rows;

    const [call] = provider.calls;
    expect(call!.images).toHaveLength(1);
    expect(call!.images[0]!.mimeType).toBe('image/jpeg');
    expect(await sizeOf(call!.images[0]!.data)).toEqual([2048, 1365]);

    expect(row).toMatchObject({
      photo: 'villa-kok-1',
      home: 'villa',
      provider: 'fake',
      model: 'fake-model',
      modelVersion: 'fake:fake-model',
      mode: 'alone',
      earlier: 0,
      status: 'ok',
      expected: 4,
      found: 3,
      matched: 3,
      precision: 1,
      recall: 0.75,
      typeAccuracy: 1,
      wallAccuracy: 1,
      countsByType: 'power.ceiling_light=0/1 power.outlet=2/2 power.switch=1/1',
      unitCountAccuracy: 1,
      propsAccuracy: 1,
      // Two references only: every position is rough, and the height is the type's default.
      roughShare: 1,
      meanHeightError: 0,
      corrections: 0,
      calls: 1,
    });
    expect(row!.countAccuracy as number).toBeCloseTo(0.75, 12);
    // The switch at image x 795 of the 4 m face is at 3.18 m; the facit measured 3.30 m.
    expect(row!.meanOffsetError as number).toBeCloseTo(0.12, 2);
    expect(row!.costUsd).toBeUndefined();

    const csv = (await readFile(join(resultsDir, 'photo.csv'), 'utf8')).trim().split('\n');
    expect(csv[0]).toBe(PHOTO_COLUMNS.join(','));
    expect(csv[1]).toContain(
      '2026-11-24T10:00:00.000Z,villa-kok-1,villa,fake,fake-model,fake:fake-model,alone,0,ok',
    );

    const raw = await readdir(join(resultsDir, 'raw'));
    expect(raw).toEqual(['2026-11-24T10-00-00-000Z-villa-kok-1-fake-model-alone.json']);
    const saved = JSON.parse(await readFile(join(resultsDir, 'raw', raw[0]!), 'utf8')) as {
      context: { walls: { id: string }[]; devices: unknown[]; targetWallId: string };
      run: { output: unknown };
      suggestions: unknown[];
    };
    expect(saved.context.walls[0]!.id).toBe(ids.outer);
    expect(saved.context.targetWallId).toBe(ids.outer);
    expect(saved.context.devices).toEqual([]);
    expect(saved.run.output).toEqual(wallReply());
    expect(saved.suggestions).toHaveLength(3);
    expect(JSON.stringify(saved)).not.toContain(call!.images[0]!.data.slice(0, 100));

    await run([wallReply()]).rows;
    const twice = (await readFile(join(resultsDir, 'photo.csv'), 'utf8')).trim().split('\n');
    expect(twice).toHaveLength(3);
  });

  it('sends earlier photos of the same room with --earlier, same wall first', async () => {
    const general: PhotoFacit = { ...wallFacit(ids), wall: null };
    const hall: PhotoFacit = {
      room: ids.hall,
      wall: ids.shared,
      devices: [],
      notes: '',
    };
    await setUp([
      { name: 'villa-kok-1', facit: wallFacit(ids) },
      { name: 'villa-kok-2', facit: general },
      { name: 'villa-hall-1', facit: hall },
      { name: 'villa-kok-3', facit: wallFacit(ids) },
    ]);
    const { provider, rows } = run([wallReply()], { photos: ['villa-kok-3'], earlier: true });
    const [row] = await rows;
    expect(row).toMatchObject({ photo: 'villa-kok-3', mode: 'earlier', earlier: 2 });
    const images = provider.calls[0]!.images;
    expect(images).toHaveLength(3);
    expect(await sizeOf(images[1]!.data)).toEqual([1024, 683]);
    const raw = await readdir(join(resultsDir, 'raw'));
    const saved = JSON.parse(await readFile(join(resultsDir, 'raw', raw[0]!), 'utf8')) as {
      earlier: string[];
    };
    expect(saved.earlier).toEqual(['villa-kok-1', 'villa-kok-2']);

    // Without --earlier each photo is judged alone.
    const alone = run([wallReply()], { photos: ['villa-kok-3'] });
    expect((await alone.rows)[0]).toMatchObject({ mode: 'alone', earlier: 0 });
    expect(alone.provider.calls[0]!.images).toHaveLength(1);
  });

  it('records a failed run with only the expected count', async () => {
    await setUp([{ name: 'villa-kok-1', facit: wallFacit(ids) }]);
    const [row] = await run([new ProviderError('error', 'boom')]).rows;
    expect(row).toMatchObject({ status: 'error', expected: 4, found: undefined });
    expect(row!.error).toContain('boom');
  });

  it('refuses to run when a photo does not match its checksum', async () => {
    await setUp([{ name: 'villa-kok-1', facit: wallFacit(ids), sha: '0'.repeat(64) }]);
    const { provider, rows } = run([wallReply()]);
    await expect(rows).rejects.toThrow(/does not match its sha256/);
    expect(provider.calls).toHaveLength(0);
  });

  it('refuses to run when a facit does not fit its floor, and unknown photo names', async () => {
    await setUp([{ name: 'villa-kok-1', facit: { ...wallFacit(ids), wall: ids.loose } }]);
    const { provider, rows } = run([wallReply()]);
    await expect(rows).rejects.toThrow(`villa-kok-1: wall ${ids.loose} does not border the room`);
    expect(provider.calls).toHaveLength(0);
    await expect(run([wallReply()], { photos: ['nope'] }).rows).rejects.toThrow(
      'Unknown photos: nope',
    );
  });

  it('has a CSV column for every score', () => {
    const scores: Record<keyof PhotoScores, true> = {
      expected: true,
      found: true,
      matched: true,
      precision: true,
      recall: true,
      typeAccuracy: true,
      wallAccuracy: true,
      countAccuracy: true,
      countsByType: true,
      unitCountAccuracy: true,
      propsAccuracy: true,
      meanOffsetError: true,
      meanHeightError: true,
      roughShare: true,
      corrections: true,
    };
    expect(PHOTO_COLUMNS).toEqual(expect.arrayContaining(Object.keys(scores)));
  });
});
