import {
  EARLIER_PHOTO_SIDE,
  earlierPhotos,
  PHOTO_MAX_SIDE,
  PHOTO_TYPE,
  photoContext,
  photoPass,
  runPass,
  type ModelChoice,
  type PhotoDetectableInput,
  type PhotoInput,
  type PhotoShot,
} from '@el-karta/ai-passes';
import { costUsd, type AiProvider } from '@el-karta/ai-providers';
import type { AttachmentRegion, FloorRecord, Id } from '@el-karta/core';
import { dirname, join, resolve } from 'node:path';
import { checkFiles, passChoice, readJson, writeRaw } from '../common.ts';
import { appendCsv, type CsvValue } from '../csv.ts';
import { photoDetectable } from './detectable.ts';
import {
  facitProblems,
  parsePhotoFloor,
  PhotoFacit,
  PhotoManifest,
  photoName,
  type PhotoManifestEntry,
} from './facit.ts';
import { loadPhotoFile, type PhotoFile } from './image.ts';
import {
  correctionCount,
  failedPhotoScores,
  foundDevices,
  scorePhoto,
  type PhotoScores,
} from './score.ts';

const here = import.meta.dirname;

/** `alone`: each photo is read without earlier ones; `earlier`: with up to three of its room. */
export type PhotoEvalMode = 'alone' | 'earlier';

export const PHOTO_COLUMNS = [
  'date',
  'photo',
  'home',
  'provider',
  'model',
  'modelVersion',
  'mode',
  'earlier',
  'status',
  'expected',
  'found',
  'matched',
  'precision',
  'recall',
  'typeAccuracy',
  'wallAccuracy',
  'countAccuracy',
  'countsByType',
  'unitCountAccuracy',
  'propsAccuracy',
  'meanOffsetError',
  'meanHeightError',
  'roughShare',
  'corrections',
  'inputTokens',
  'outputTokens',
  'costUsd',
  'calls',
  'durationMs',
  'error',
] as const;
export type PhotoRow = Partial<Record<(typeof PHOTO_COLUMNS)[number], CsvValue>>;

export interface PhotoEvalOptions {
  provider: AiProvider;
  model: string;
  /** Photo names (file without extension) to run; every photo in the manifest when left out. */
  photos?: readonly string[] | undefined;
  /** Sends up to three other photos of the same room, as the app does (mode `earlier`). */
  earlier?: boolean;
  manifestPath?: string;
  /** Overrides the manifest's `imagesDir`, e.g. when running from a git worktree. */
  imagesDir?: string | undefined;
  facitDir?: string;
  floorsDir?: string;
  resultsDir?: string;
  /** The types the app sends; the copy in `detectable.ts` by default. */
  detectable?: readonly PhotoDetectableInput[];
  now?: () => Date;
  newId?: () => Id;
  loadPhoto?: (path: string) => Promise<PhotoFile>;
  log?: (line: string) => void;
}

export const photoEvalChoice = (
  provider: string | undefined,
  model: string | undefined,
): ModelChoice => passChoice('photo', provider, model);

interface Shot extends PhotoShot {
  entry: PhotoManifestEntry;
  facit: PhotoFacit;
  path: string;
}

const regionOf = (facit: PhotoFacit): AttachmentRegion =>
  facit.wall === null ? { roomId: facit.room } : { roomId: facit.room, wallId: facit.wall };

const noPending = { pending: [], pendingCorrections: { openingIds: [], roomIds: [] } };

/**
 * Runs the photo pass on each photo as the app does (the context from the exported floor and the
 * facit's room and wall, `runPass`, then `toSuggestions` with nothing pending), scores the device
 * suggestions against the facit, appends a row per photo to `results/photo.csv` and writes the
 * model output and suggestions to `results/raw/`. Devices already on the exported floor are left
 * out of the context, so every visible device has to be found from the photo.
 */
export async function runPhotoEval(options: PhotoEvalOptions): Promise<PhotoRow[]> {
  const manifestPath = options.manifestPath ?? join(here, 'manifest.json');
  const facitDir = options.facitDir ?? join(here, 'facit');
  const floorsDir = options.floorsDir ?? join(here, 'floors');
  const resultsDir = options.resultsDir ?? resolve(here, '../results');
  const detectable = options.detectable ?? photoDetectable;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const loadPhoto = options.loadPhoto ?? loadPhotoFile;
  const log = options.log ?? (() => {});
  const mode: PhotoEvalMode = options.earlier ? 'earlier' : 'alone';

  const manifest = PhotoManifest.parse(await readJson(manifestPath));
  const imagesDir = options.imagesDir ?? resolve(dirname(manifestPath), manifest.imagesDir);
  const names = manifest.photos.map(photoName);
  const unknown = options.photos?.filter((name) => !names.includes(name)) ?? [];
  if (unknown.length > 0) throw new Error(`Unknown photos: ${unknown.join(', ')}`);
  const selected = options.photos
    ? manifest.photos.filter((p) => options.photos!.includes(photoName(p)))
    : manifest.photos;
  // Earlier photos come from the same home, so with --earlier those are read and checked too.
  const homes = new Set(selected.map((p) => p.home));
  const used = options.earlier ? manifest.photos.filter((p) => homes.has(p.home)) : selected;

  const floors = new Map<string, FloorRecord>();
  for (const home of homes)
    floors.set(home, parsePhotoFloor(await readJson(join(floorsDir, `${home}.json`))));
  const shots: Shot[] = [];
  const problems: string[] = [];
  for (const [index, entry] of used.entries()) {
    const name = photoName(entry);
    const facit = PhotoFacit.parse(await readJson(join(facitDir, `${name}.json`)));
    problems.push(
      ...facitProblems(facit, floors.get(entry.home)!, detectable).map((p) => `${name}: ${p}`),
    );
    // Later in the manifest counts as more recent, as `createdAt` does in the app.
    const createdAt = String(index).padStart(6, '0');
    const path = join(imagesDir, entry.file);
    shots.push({ id: name, region: regionOf(facit), createdAt, entry, facit, path });
  }
  if (problems.length > 0) throw new Error(`Facit does not fit its floor:\n${problems.join('\n')}`);
  await checkFiles(shots.map((s) => ({ name: s.id, path: s.path, sha256: s.entry.sha256 })));

  const rows: PhotoRow[] = [];
  for (const shot of shots.filter((s) => selected.includes(s.entry))) {
    const { entry, facit } = shot;
    const floor = floors.get(entry.home)!;
    const context = photoContext({ ...floor.data, devices: {} }, shot.region!, detectable)!;
    const date = now();
    const photo = await loadPhoto(shot.path);
    const sameHome = shots.filter((s) => s.entry.home === entry.home);
    const earlier = options.earlier ? earlierPhotos(sameHome, shot) : [];
    const input: PhotoInput = {
      ...context,
      image: { mimeType: PHOTO_TYPE, data: await photo.encode(PHOTO_MAX_SIDE) },
      earlier: await Promise.all(
        earlier.map(async (s) => ({
          mimeType: PHOTO_TYPE,
          data: await (await loadPhoto(s.path)).encode(EARLIER_PHOTO_SIDE),
        })),
      ),
    };

    const start = performance.now();
    const run = await runPass(photoPass, input, {
      provider: options.provider,
      model: options.model,
    });
    const durationMs = Math.round(performance.now() - start);
    const drafts = run.output
      ? photoPass.toSuggestions(run.output, { ...context, photoId: newId(), ...noPending }, newId)
      : [];
    const scores: PhotoScores = run.output
      ? scorePhoto(facit, foundDevices(drafts), correctionCount(drafts), detectable)
      : failedPhotoScores(facit);
    const calls = 1 + run.validationRetries;

    const row: PhotoRow = {
      date: date.toISOString(),
      photo: shot.id,
      home: entry.home,
      provider: options.provider.id,
      model: options.model,
      modelVersion: run.modelVersion,
      mode,
      earlier: input.earlier.length,
      status: run.status,
      ...scores,
      inputTokens: run.usage.inputTokens,
      outputTokens: run.usage.outputTokens,
      costUsd: costUsd(options.provider.id, options.model, run.usage, calls)?.toFixed(6),
      calls,
      durationMs,
      error: run.error,
    };
    rows.push(row);
    await appendCsv(join(resultsDir, 'photo.csv'), PHOTO_COLUMNS, [row]);
    await writeRaw(resultsDir, date, [shot.id, options.model, mode], {
      photo: shot.id,
      image: { width: photo.width, height: photo.height },
      earlier: earlier.map((s) => s.id),
      context,
      run,
      suggestions: drafts,
      scores,
      row,
    });
    log(
      `${shot.id}: ${run.status}, found ${String(scores.found ?? '-')}/${scores.expected}, matched ${String(scores.matched ?? '-')}, ${durationMs} ms`,
    );
  }
  return rows;
}
