import { defaultModels, photoPass, type PhotoInput } from '@el-karta/ai-passes';
import {
  generateProject,
  photoDetectables,
  type Device,
  type FloorData,
  type Id,
  type Suggestion,
} from '@el-karta/core';
import { AI_PASS_MAX_BODY_BYTES, type Attachment } from '@el-karta/data-supabase';
import { describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '@/features/floorplan/ai-import/fixtures';
import { AiPassFailure } from '@/lib/ai-pass';
import { registry } from '@/plugins';
import { analysePhoto, analysisErrorCode, AnalysisError, type AnalysisDeps } from './analysis';
import { earlierPhotos, pendingOnFloor, photoContext, roomWalls } from './context';
import { EARLIER_SIDES, photoRunInput, type PhotoImage } from './request';
import { ID, outlet, photo, photoReply, WALLED, walledKitchen } from './test-fixtures';

const detectable = photoDetectables(registry);
const never = new AbortController().signal;
const newId = () => crypto.randomUUID();

const kitchen = () => {
  const project = walledKitchen();
  const floor = project.model.floors[project.floorId]!;
  return { project, floor, data: floor.data };
};

describe('roomWalls', () => {
  it('lists the room’s walls clockwise from the photographed one, each with the face into the room', () => {
    const { data } = kitchen();
    const walls = roomWalls(data, ID.kitchen, ID.outer);
    expect(walls.map((w) => w.id)).toEqual([ID.outer, ID.shared, WALLED.bottom, WALLED.left]);
    expect(walls.map((w) => w.side)).toEqual(['right', 'right', 'right', 'right']);
    expect(roomWalls(data, ID.kitchen, WALLED.bottom).map((w) => w.id)).toEqual([
      WALLED.bottom,
      WALLED.left,
      ID.outer,
      ID.shared,
    ]);
    // The hall sees the shared wall from its other face.
    expect(roomWalls(data, ID.hall)).toEqual([
      expect.objectContaining({ id: ID.shared, side: 'left' }),
    ]);
  });
});

describe('photoContext', () => {
  it('gives the room, its walls with their openings (hinge and swing kept) and its devices of detectable types', () => {
    const { data } = kitchen();
    data.devices = {
      mine: outlet('mine'),
      // Same wall, the hall's face: not in the kitchen.
      other: {
        ...outlet('other'),
        placement: { kind: 'wall', wallId: ID.shared, offset: 1, side: 'left', height: 0.25 },
      },
      sofa: { ...outlet('sofa'), domain: 'furnishing', type: 'sofa' },
    };
    data.rooms[ID.kitchen]!.ceilingHeight = 2.4;
    const context = photoContext(data, { roomId: ID.kitchen, wallId: ID.outer }, detectable)!;

    expect(context.room).toMatchObject({ id: ID.kitchen, name: 'Kök', ceilingHeight: 2.4 });
    expect(context.walls[0]!.id).toBe(ID.outer);
    expect(context.targetWallId).toBe(ID.outer);
    expect(context.openings).toEqual([
      expect.objectContaining({ id: WALLED.window, sill: 0.9 }),
      expect.objectContaining({ id: WALLED.door, hinge: 'left', swing: 'in' }),
    ]);
    expect(context.devices.map((d) => d.id)).toEqual(['mine']);
    expect(context.detectable).toEqual(detectable);
  });

  it('takes the floor height without a room height, and no target for the room in general', () => {
    const { data } = kitchen();
    const context = photoContext(data, { roomId: ID.kitchen }, detectable)!;
    expect(context.room.ceilingHeight).toBe(data.height);
    expect(context.targetWallId).toBeNull();
  });

  it('has none for a room that is gone or has no walls', () => {
    const { data } = kitchen();
    expect(photoContext(data, { roomId: crypto.randomUUID() }, detectable)).toBeNull();
    const bare: FloorData = { ...data, walls: {} };
    expect(photoContext(bare, { roomId: ID.kitchen }, detectable)).toBeNull();
  });
});

describe('earlierPhotos', () => {
  const at = (hour: number) => `2026-11-24T${String(hour).padStart(2, '0')}:00:00Z`;
  const shot = (n: number, wallId: Id | undefined, hour: number, roomId: Id = ID.kitchen) =>
    photo(`p${String(n)}`, 'f', wallId ? { roomId, wallId } : { roomId }, at(hour));

  it('sends photos of the same wall first, then the most recent, at most three', () => {
    const current = shot(0, ID.outer, 12);
    const photos = [
      shot(1, ID.shared, 11),
      shot(2, ID.outer, 8),
      shot(3, undefined, 10),
      shot(4, ID.outer, 9),
      shot(5, ID.outer, 9, ID.hall),
      current,
    ];
    expect(earlierPhotos(photos, current).map((p) => p.id)).toEqual(['p4', 'p2', 'p1']);
    // A photo of the room in general has no wall to share: the most recent go first.
    const general = shot(6, undefined, 13);
    expect(earlierPhotos([...photos, general], general).map((p) => p.id)).toEqual([
      'p0',
      'p1',
      'p3',
    ]);
  });
});

describe('pendingOnFloor', () => {
  const row = (kind: string, payload: unknown, status: Suggestion['status'] = 'pending') =>
    ({ id: newId(), kind, payload, status }) as Suggestion;

  it('collects pending devices and the openings and rooms with a correction waiting', () => {
    const device = outlet('d1');
    const result = pendingOnFloor(
      [
        row('device', device),
        row('device', outlet('d2'), 'accepted'),
        row('opening', { id: WALLED.window }),
        row('room-ceiling-height', { roomId: ID.kitchen, ceilingHeight: 2.5 }),
        row('device', 'unreadable'),
      ],
      (s) => (typeof s.payload === 'object' ? s.payload : null),
    );
    expect(result).toEqual({
      pending: [device],
      pendingCorrections: { openingIds: [WALLED.window], roomIds: [ID.kitchen] },
    });
  });
});

/** An image whose base64 is `chars(side)` characters long at each size. */
const sized = (chars: (side: number | null) => number): PhotoImage => ({
  encode: (side) => Promise.resolve('x'.repeat(chars(side))),
});

const requestBytes = (input: PhotoInput) =>
  new TextEncoder().encode(
    JSON.stringify({ action: 'run', pass: 'photo', projectId: newId(), floorId: newId(), input }),
  ).length;

describe('photoRunInput', () => {
  const MB = 1024 * 1024;

  it('keeps the request for the largest room of the large synthetic project under the cap', async () => {
    const model = generateProject('large');
    const floors = Object.values(model.floors);
    const area = (polygon: readonly { x: number; y: number }[]) =>
      Math.abs(
        polygon.reduce((s, p, i) => {
          const q = polygon[(i + 1) % polygon.length]!;
          return s + p.x * q.y - q.x * p.y;
        }, 0),
      ) / 2;
    const [floor, room] = floors
      .flatMap((f) => Object.values(f.data.rooms).map((r) => [f, r] as const))
      .sort((a, b) => area(b[1].polygon) - area(a[1].polygon))[0]!;
    const start = performance.now();
    const context = photoContext(floor.data, { roomId: room.id }, detectable)!;
    const ms = performance.now() - start;
    const largest = { context, walls: context.walls.length };
    // Probing only walls near the room keeps this independent of the floor's size.
    expect(ms).toBeLessThan(100);
    expect(largest.walls).toBeGreaterThan(3);

    // A stored photo at 2048 px is about 1 MB of base64; earlier photos at 1024 px are made large
    // on purpose, so the last of them only fits smaller and the cap decides.
    const main = sized((side) => (side === null ? 1_400_000 : 600_000));
    const earlier = [0, 1, 2].map(() =>
      sized((side) => ({ 1024: 1_500_000, 768: 800_000, 512: 400_000 })[side ?? 1024] ?? 0),
    );
    const input = await photoRunInput(largest.context, main, earlier);

    expect(requestBytes(input)).toBeLessThanOrEqual(AI_PASS_MAX_BODY_BYTES);
    expect(input.image.data.length).toBe(1_400_000);
    expect(input.earlier.map((e) => e.data.length)).toEqual([1_500_000, 800_000, 400_000]);
  });

  it('sends every earlier photo at 1024 px when they fit, and the photo smaller when it alone is too big', async () => {
    const { data } = kitchen();
    const context = photoContext(data, { roomId: ID.kitchen, wallId: ID.outer }, detectable)!;
    const asked: (number | null)[] = [];
    const small = sized((side) => (asked.push(side), 100_000));
    const all = await photoRunInput(context, small, [small, small, small]);
    expect(all.earlier).toHaveLength(3);
    expect(asked).toEqual([null, EARLIER_SIDES[0], EARLIER_SIDES[0], EARLIER_SIDES[0]]);

    const huge = sized((side) => (side === null ? 5 * MB : 2 * MB));
    const shrunk = await photoRunInput(context, huge, []);
    expect(shrunk.image.data.length).toBe(2 * MB);

    await expect(
      photoRunInput(
        context,
        sized(() => 5 * MB),
        [],
      ),
    ).rejects.toEqual(new AiPassFailure('too_large'));
  });
});

describe('analysePhoto', () => {
  const PHOTO_ID = '00000000-0000-4000-8000-0000000000a1';
  const loaded: Id[] = [];

  function setup(reply: () => unknown = photoReply) {
    const { project, floor } = kitchen();
    const fake = fakeBackend(() => Promise.resolve(reply()));
    loaded.length = 0;
    const deps: AnalysisDeps = {
      backend: fake.deps.backend,
      source: fake.deps.source,
      queries: fake.deps.queries,
      detectable,
      loadPhoto: (id) => {
        loaded.push(id);
        return Promise.resolve(new Blob([id]));
      },
      toImage: () => sized(() => 1000),
      newId,
    };
    return { project, floor, fake, deps };
  }
  const ofWall = { id: PHOTO_ID, region: { roomId: ID.kitchen, wallId: ID.outer } };

  it('runs the photo pass on the room and stores its devices on the wall, with the photo as evidence', async () => {
    const { floor, fake, deps } = setup();
    const steps: string[] = [];
    const earlier = [photo('e1', floor.id, { roomId: ID.kitchen, wallId: ID.outer })];
    const count = await analysePhoto(floor, ofWall, earlier, null, deps, never, (s) =>
      steps.push(s),
    );

    expect(steps).toEqual(['preparing', 'reading', 'saving']);
    expect(loaded).toEqual([PHOTO_ID, 'e1']);
    const [run] = fake.runs;
    expect(run).toMatchObject({ pass: 'photo', projectId: floor.projectId, floorId: floor.id });
    const input = run!.input as PhotoInput;
    expect(input.walls[0]!.id).toBe(ID.outer);
    expect(input.earlier).toHaveLength(1);

    expect(count).toBe(3);
    const [commit] = fake.commits;
    expect(commit!.source).toBe(`ai:photo:${defaultModels['photo']!.primary.model}`);
    expect(commit!.runIds).toEqual([expect.any(String)]);
    const devices = commit!.suggestions.map((s) => s.payload as Device);
    expect(devices.map((d) => d.type)).toEqual(['outlet', 'outlet', 'switch']);
    for (const d of devices) {
      expect(d.attachmentIds).toEqual([PHOTO_ID]);
      expect(d.placement).toMatchObject({ kind: 'wall', wallId: ID.outer, side: 'right' });
    }
    // Rough positions between the wall's floor corners at image x 0 and 1000 (the face is 4 m).
    const offsets = devices.map((d) => (d.placement.kind === 'wall' ? d.placement.offset : NaN));
    expect(offsets[0]).toBeCloseTo(1, 2);
    expect(offsets[1]).toBeCloseTo(2.2, 2);
    expect(devices[0]!.count).toBe(2);
    expect(devices[2]!.props).toEqual({ variant: 'single' });
  });

  it('suggests nothing twice: a second photo of the same wall finds its devices pending', async () => {
    const { floor, fake, deps } = setup();
    await analysePhoto(floor, ofWall, [], new Blob(['jpeg']), deps, never, () => {});
    expect(loaded).toEqual([]);
    const second = { ...ofWall, id: newId() };
    const count = await analysePhoto(floor, second, [], new Blob(['jpeg']), deps, never, () => {});
    expect(count).toBe(0);
    expect(fake.commits).toHaveLength(1);
  });

  it('passes pending corrections on, so they are not suggested again', async () => {
    const { floor, fake, deps } = setup();
    const correction: Suggestion = {
      id: newId(),
      projectId: floor.projectId,
      floorId: floor.id,
      runId: null,
      pass: 'photo',
      kind: 'room-ceiling-height',
      source: 'ai:photo:m',
      payload: { roomId: ID.kitchen, ceilingHeight: 2.6 },
      issues: [],
      requires: [],
      status: 'pending',
    };
    fake.rows.set(correction.id, correction);
    const spy = vi.spyOn(photoPass, 'toSuggestions');
    await analysePhoto(floor, ofWall, [], null, deps, never, () => {});
    expect(spy.mock.calls[0]![1]).toMatchObject({
      photoId: PHOTO_ID,
      pendingCorrections: { openingIds: [], roomIds: [ID.kitchen] },
    });
    spy.mockRestore();
  });

  it('keeps the issues left after an invalid run on every suggestion', async () => {
    const { floor, fake, deps } = setup();
    const backend = deps.backend;
    deps.backend = {
      ...backend,
      run: async (request, signal) => ({
        ...(await backend.run(request, signal)),
        status: 'invalid',
        issues: [{ code: 'photo.point-outside', severity: 'warning', ids: [] }],
      }),
    };
    await analysePhoto(floor, ofWall, [], null, deps, never, () => {});
    for (const s of fake.commits[0]!.suggestions)
      expect(s.issues).toContainEqual({ code: 'photo.point-outside', severity: 'warning' });
  });

  it('stops with a code for a missing room, a missing file and an unusable answer, storing nothing', async () => {
    const { floor, fake, deps } = setup(() => ({ wall: 'A' }));
    const fail = (p: Pick<Attachment, 'id' | 'region'>, d: AnalysisDeps = deps) =>
      analysePhoto(floor, p, [], null, d, never, () => {}).catch((e: unknown) =>
        analysisErrorCode(e),
      );

    expect(await fail({ id: PHOTO_ID, region: null })).toBe('no_room');
    expect(await fail({ id: PHOTO_ID, region: { roomId: newId() } })).toBe('no_room');
    expect(await fail(ofWall, { ...deps, loadPhoto: () => Promise.reject(new Error('404')) })).toBe(
      'image',
    );
    expect(await fail(ofWall)).toBe('no_output');
    expect(fake.commits).toEqual([]);
    expect(analysisErrorCode(new AnalysisError('image'))).toBe('image');
    expect(analysisErrorCode(new Error('?'))).toBe('internal');
  });
});
