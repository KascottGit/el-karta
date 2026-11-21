import {
  defaultModels,
  FloorplanOutput,
  LocateOutput,
  type ReadProgress,
} from '@el-karta/ai-passes';
import {
  backgroundPlacement,
  distance,
  type FloorRecord,
  type Opening,
  type Wall,
} from '@el-karta/core';
import { describe, expect, it, vi } from 'vitest';
import envText from '../../../../e2e/fixtures/ai-import.env?raw';
import { ImportError } from './errors';
import {
  fakeBackend,
  fakeImage,
  floorWithBackground,
  planReply,
  PLAN_SIZE,
  TRUE_METRES_PER_PIXEL,
} from './fixtures';
import { commitDrafts, interpretReading, readPlan, reinterpretStored } from './flow';
import { loadReading } from './reading';

const never = new AbortController().signal;
const newId = () => crypto.randomUUID();

async function read(floor = floorWithBackground(), fake = fakeBackend()) {
  const progress: ReadProgress[] = [];
  const reading = await readPlan(floor, fakeImage(), fake.deps, never, (p) => progress.push(p));
  return { floor, fake, reading, progress };
}

const withScale = (floor: FloorRecord, metresPerPixel: number, offset = { x: 0, y: 0 }) => ({
  ...floor,
  data: {
    ...floor.data,
    scale: { source: 'user' as const, metresPerPixel },
    background: { ...floor.data.background!, offset },
  },
});

/** Imports the plan with an estimated scale, as "Uppskatta åt mig" does. */
async function importEstimated() {
  const { floor, fake, reading } = await read();
  const { interpretation, placement } = interpretReading(reading, floor.data, true, newId);
  await commitDrafts(floor, reading, interpretation.drafts, placement, fake.deps);
  return { floor, fake, reading, interpretation };
}

describe('the e2e fake reply', () => {
  it('parses as both passes, and the env file the function is served with holds it', () => {
    expect(LocateOutput.safeParse(planReply()).success).toBe(true);
    expect(FloorplanOutput.safeParse(planReply()).success).toBe(true);
    const line = envText.split('\n').find((l) => l.startsWith('AI_FAKE_REPLIES='))!;
    expect(JSON.parse(line.slice('AI_FAKE_REPLIES='.length))).toEqual([planReply()]);
  });
});

describe('readPlan', () => {
  it('locates on the whole image, reads the crop, and keeps the floorplan runs', async () => {
    const { floor, fake, reading, progress } = await read();
    expect(fake.runs.map((r) => r.pass)).toEqual(['floorplan-locate', 'floorplan']);
    expect(fake.runs.every((r) => r.projectId === floor.projectId && r.floorId === floor.id)).toBe(
      true,
    );
    expect(JSON.parse((fake.runs[0]!.input as { image: { data: string } }).image.data)).toEqual({
      x: 0,
      y: 0,
      ...PLAN_SIZE,
    });
    expect(reading).toMatchObject({
      attachmentId: floor.data.background!.attachmentId,
      frame: { x: 0, y: 0, ...PLAN_SIZE },
      imageSize: PLAN_SIZE,
      runIds: [expect.any(String)],
      source: `ai:floorplan:${defaultModels['floorplan']!}`,
    });
    expect(reading.output.rooms.map((r) => r.name)).toEqual(['Sovrum', 'Kök']);
    expect(progress).toEqual([{ step: 'locate' }, { step: 'tile', index: 0, count: 1 }]);
  });

  it('turns unusable answers into Swedish error codes and stops', async () => {
    const floor = floorWithBackground();
    const cases = [
      { status: 'rate_limited', output: null, code: 'provider_busy' },
      { status: 'error', output: null, code: 'internal' },
      { status: 'ok', output: null, code: 'no_output' },
      { status: 'ok', output: { walls: 'no' }, code: 'no_output' },
    ] as const;
    for (const c of cases) {
      const fake = fakeBackend();
      fake.deps.backend.run = (request) => {
        fake.runs.push(request);
        return Promise.resolve({ runId: newId(), status: c.status, output: c.output, issues: [] });
      };
      const error = await readPlan(floor, fakeImage(), fake.deps, never, () => {}).catch(
        (e: unknown) => e,
      );
      expect(error).toEqual(new ImportError(c.code));
      expect(fake.runs).toHaveLength(1);
    }
  });

  it('stops at once when cancelled, and makes no further calls', async () => {
    const abort = new AbortController();
    let release = () => {};
    const fake = fakeBackend(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve(planReply());
          };
        }),
    );
    const reading = readPlan(floorWithBackground(), fakeImage(), fake.deps, abort.signal, () => {});
    await vi.waitFor(() => {
      expect(fake.runs).toHaveLength(1);
    });
    abort.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await Promise.resolve();
    expect(fake.runs).toHaveLength(1);
    expect(fake.commits).toHaveLength(0);
  });
});

describe('interpretReading', () => {
  it("shows the issues left after a run's retry with the scale suggestion", async () => {
    const fake = fakeBackend();
    const run = fake.deps.backend.run.bind(fake.deps.backend);
    fake.deps.backend.run = async (request, signal) => ({
      ...(await run(request, signal)),
      status: 'invalid',
      issues: [{ code: 'ai.dimension-invalid', severity: 'error', ids: [] }],
    });
    const { floor, reading } = await read(floorWithBackground(), fake);
    expect(reading.issues).toEqual([{ code: 'ai.dimension-invalid', severity: 'error' }]);
    const { interpretation } = interpretReading(reading, floor.data, true, newId);
    const scale = interpretation.drafts.find((d) => d.kind === 'scale')!;
    expect(scale.issues).toContainEqual({ code: 'ai.dimension-invalid', severity: 'error' });
    const walls = interpretation.drafts.filter((d) => d.kind === 'wall');
    expect(walls.every((w) => w.issues.every((i) => i.code !== 'ai.dimension-invalid'))).toBe(true);
    expect(interpretation.issues).toContainEqual({
      code: 'ai.dimension-invalid',
      severity: 'error',
    });
  });

  it('finds no scale in the reply unless estimating, and estimates it from the standard objects', async () => {
    const { floor, reading } = await read();
    expect(interpretReading(reading, floor.data, false, newId).interpretation.scale.status).toBe(
      'none',
    );
    const { interpretation, placement } = interpretReading(reading, floor.data, true, newId);
    expect(interpretation.scale.status).toBe('estimate');
    expect(placement.metresPerPixel).toBeCloseTo(TRUE_METRES_PER_PIXEL, 6);
    const scale = interpretation.drafts.find((d) => d.kind === 'scale')!;
    expect(scale.payload).toMatchObject({ source: 'ai_estimate' });
    const walls = interpretation.drafts.filter((d) => d.kind === 'wall');
    expect(walls.length).toBeGreaterThanOrEqual(5);
    expect(walls.every((w) => w.requires.includes(scale.id))).toBe(true);
    expect(interpretation.drafts.filter((d) => d.kind === 'room')).toHaveLength(2);
    expect(interpretation.drafts.filter((d) => d.kind === 'opening')).toHaveLength(1);
  });

  it("keeps the floor's user scale and placement, so nothing requires a scale suggestion", async () => {
    const { reading } = await read();
    const floor = withScale(floorWithBackground(), 0.01, { x: 2, y: 3 });
    const { interpretation, placement } = interpretReading(reading, floor.data, false, newId);
    expect(interpretation.scale.status).toBe('user');
    expect(placement).toEqual(backgroundPlacement(floor.data.background, floor.data.scale));
    expect(interpretation.drafts.some((d) => d.kind === 'scale')).toBe(false);
    const walls = interpretation.drafts.filter((d) => d.kind === 'wall');
    expect(walls.every((w) => w.requires.length === 0)).toBe(true);
    // The top-left plan corner, at (103, 102) px, lies at the offset plus 1 cm per pixel.
    const corner = { x: 2 + 103 * 0.01, y: 3 + 102 * 0.01 };
    const ends = walls.flatMap((w) => [(w.payload as Wall).a, (w.payload as Wall).b]);
    expect(Math.min(...ends.map((p) => distance(p, corner)))).toBeLessThan(0.05);
  });
});

describe('commitDrafts', () => {
  it('stores the reading, then the drafts as pending suggestions, and refreshes the suggestions', async () => {
    const { floor, fake, reading } = await read();
    const invalidate = vi.spyOn(fake.deps.queries, 'invalidateQueries');
    const { interpretation, placement } = interpretReading(reading, floor.data, true, newId);
    const count = await commitDrafts(floor, reading, interpretation.drafts, placement, fake.deps);
    expect(count).toBe(interpretation.drafts.length);
    expect(fake.commits).toHaveLength(1);
    expect(fake.commits[0]).toMatchObject({
      pass: 'floorplan',
      projectId: floor.projectId,
      floorId: floor.id,
      runIds: reading.runIds,
      source: reading.source,
    });
    expect(fake.withStatus('pending')).toHaveLength(interpretation.drafts.length);
    const stored = await loadReading(fake.files, floor.projectId, floor.id);
    expect(stored).toEqual({
      ...reading,
      suggestions: interpretation.drafts.map((d) => ({ id: d.id, placement })),
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['suggestions'] });
  });

  it("replaces the previous import's pending suggestions and keeps its decided ones", async () => {
    const { floor, fake, reading, interpretation } = await importEstimated();
    const [first, second] = interpretation.drafts;
    await fake.deps.source.setStatus([first!.id], 'accepted');
    await fake.deps.source.setStatus([second!.id], 'rejected');
    const again = interpretReading(reading, floor.data, true, newId);
    await commitDrafts(floor, reading, again.interpretation.drafts, again.placement, fake.deps);
    expect(fake.rows.get(first!.id)!.status).toBe('accepted');
    const pending = fake.withStatus('pending').map((s) => s.id);
    expect(pending.sort()).toEqual(again.interpretation.drafts.map((d) => d.id).sort());
    expect(fake.withStatus('rejected')).toHaveLength(interpretation.drafts.length - 1);
  });

  it('a fresh import of the same image leaves out what was accepted from the last one', async () => {
    const { floor, fake, interpretation } = await importEstimated();
    const walls = interpretation.drafts.filter((d) => d.kind === 'wall');
    const scale = interpretation.drafts.find((d) => d.kind === 'scale')!;
    await fake.deps.source.setStatus([scale.id, ...walls.map((w) => w.id)], 'accepted');
    const accepted = { ...floor, data: { ...floor.data, scale: interpretation.scale.scale! } };

    const { reading } = await read(accepted, fake);
    const again = interpretReading(reading, accepted.data, true, newId);
    await commitDrafts(accepted, reading, again.interpretation.drafts, again.placement, fake.deps);
    const pending = fake.withStatus('pending');
    expect(pending.some((s) => s.kind === 'wall')).toBe(false);
    // The door now hangs on its accepted wall.
    const door = pending.find((s) => s.kind === 'opening')!;
    expect(walls.map((w) => w.id)).toContain(door.requires[0]);
    expect(walls.map((w) => (w.payload as Wall).id)).toContain((door.payload as Opening).wallId);
  });

  it('stores nothing when there is nothing to suggest', async () => {
    const { floor, fake, reading } = await read();
    const placement = backgroundPlacement(floor.data.background, floor.data.scale)!;
    await expect(commitDrafts(floor, reading, [], placement, fake.deps)).rejects.toEqual(
      new ImportError('empty'),
    );
    expect(fake.commits).toHaveLength(0);
    expect(fake.files.files.size).toBe(0);
  });
});

describe('reinterpretStored', () => {
  it('re-measures pending suggestions at a new scale and leaves accepted ones alone', async () => {
    const { floor, fake, interpretation } = await importEstimated();
    const scale = interpretation.drafts.find((d) => d.kind === 'scale')!;
    const wall = interpretation.drafts.find((d) => d.kind === 'wall')!;
    await fake.deps.source.setStatus([scale.id, wall.id], 'accepted');
    const pendingBefore = fake.withStatus('pending').map((s) => s.id);

    // The person measures a scale 25 % larger; the scale tool keeps the measurement's middle put.
    const measured = withScale(floor, TRUE_METRES_PER_PIXEL * 1.25, { x: -0.5, y: -0.4 });
    const count = await reinterpretStored(measured, fake.deps);
    expect(count).toBe(interpretation.drafts.length - 2);
    for (const id of pendingBefore) expect(fake.rows.get(id)!.status).toBe('rejected');
    const replaced = fake.withStatus('pending');
    expect(replaced).toHaveLength(count!);
    expect(replaced.some((s) => s.kind === 'scale')).toBe(false);
    expect(replaced.every((s) => s.requires.every((r) => fake.rows.has(r)))).toBe(true);
    expect(replaced.filter((s) => s.kind === 'wall').every((s) => s.requires.length === 0)).toBe(
      true,
    );

    const placement = backgroundPlacement(measured.data.background, measured.data.scale)!;
    const old = wall.payload as Wall;
    const moved = (p: { x: number; y: number }) => ({
      x: placement.offset.x + (p.x / TRUE_METRES_PER_PIXEL) * placement.metresPerPixel,
      y: placement.offset.y + (p.y / TRUE_METRES_PER_PIXEL) * placement.metresPerPixel,
    });
    const repeats = replaced
      .filter((s) => s.kind === 'wall')
      .map((s) => s.payload as Wall)
      .filter((w) => distance(w.a, moved(old.a)) < 0.15 && distance(w.b, moved(old.b)) < 0.15);
    expect(repeats).toEqual([]);
    const openings = replaced.filter((s) => s.kind === 'opening').map((s) => s.payload as Opening);
    const walls = new Set([
      (wall.payload as Wall).id,
      ...replaced.map((s) => (s.payload as { id: string }).id),
    ]);
    expect(openings.every((o) => walls.has(o.wallId))).toBe(true);
  });

  it('twice in a row replaces the latest pending suggestions and never repeats an accepted wall', async () => {
    const { floor, fake, interpretation } = await importEstimated();
    const wall = interpretation.drafts.find((d) => d.kind === 'wall')!;
    const scale = interpretation.drafts.find((d) => d.kind === 'scale')!;
    await fake.deps.source.setStatus([scale.id, wall.id], 'accepted');

    await reinterpretStored(withScale(floor, TRUE_METRES_PER_PIXEL * 1.25), fake.deps);
    const middle = fake.withStatus('pending').map((s) => s.id);
    const last = withScale(floor, TRUE_METRES_PER_PIXEL * 1.5, { x: 1, y: 1 });
    const count = await reinterpretStored(last, fake.deps);
    for (const id of middle) expect(fake.rows.get(id)!.status).toBe('rejected');
    expect(fake.withStatus('pending')).toHaveLength(count!);
    expect(count).toBe(interpretation.drafts.length - 2);

    const placement = backgroundPlacement(last.data.background, last.data.scale)!;
    const old = wall.payload as Wall;
    const moved = (p: { x: number; y: number }) => ({
      x: placement.offset.x + (p.x / TRUE_METRES_PER_PIXEL) * placement.metresPerPixel,
      y: placement.offset.y + (p.y / TRUE_METRES_PER_PIXEL) * placement.metresPerPixel,
    });
    const repeats = fake
      .withStatus('pending')
      .filter((s) => s.kind === 'wall')
      .map((s) => s.payload as Wall)
      .filter((w) => distance(w.a, moved(old.a)) < 0.15 && distance(w.b, moved(old.b)) < 0.15);
    expect(repeats).toEqual([]);
    expect(await reinterpretStored(last, fake.deps)).toBeNull();
  });

  it('after a failed commit, the next replacement still rejects the old pending suggestions', async () => {
    const { floor, fake } = await importEstimated();
    const old = fake.withStatus('pending').map((s) => s.id);
    const commit = fake.deps.backend.commit.bind(fake.deps.backend);
    fake.deps.backend.commit = () => Promise.reject(new Error('lost'));
    const measured = withScale(floor, TRUE_METRES_PER_PIXEL * 1.25);
    await expect(reinterpretStored(measured, fake.deps)).rejects.toThrow('lost');
    expect(fake.withStatus('pending').map((s) => s.id)).toEqual(old);

    fake.deps.backend.commit = commit;
    const count = await reinterpretStored(measured, fake.deps);
    for (const id of old) expect(fake.rows.get(id)!.status).toBe('rejected');
    expect(fake.withStatus('pending')).toHaveLength(count!);
  });

  it('after a failed rejection, the next replacement rejects what was left pending', async () => {
    const { floor, fake } = await importEstimated();
    const old = fake.withStatus('pending').map((s) => s.id);
    const setStatus = fake.deps.source.setStatus.bind(fake.deps.source);
    fake.deps.source.setStatus = () => Promise.reject(new Error('lost'));
    await expect(
      reinterpretStored(withScale(floor, TRUE_METRES_PER_PIXEL * 1.25), fake.deps),
    ).rejects.toThrow('lost');
    const both = fake.withStatus('pending').map((s) => s.id);
    expect(both.length).toBeGreaterThan(old.length);

    fake.deps.source.setStatus = setStatus;
    const count = await reinterpretStored(withScale(floor, TRUE_METRES_PER_PIXEL * 1.5), fake.deps);
    for (const id of both) expect(fake.rows.get(id)!.status).toBe('rejected');
    expect(fake.withStatus('pending')).toHaveLength(count!);
  });

  it('does nothing without pending suggestions, at the same placement, or for another image', async () => {
    const { floor, fake, interpretation } = await importEstimated();
    const estimated = {
      ...floor,
      data: { ...floor.data, scale: interpretation.scale.scale! },
    };
    expect(await reinterpretStored(estimated, fake.deps)).toBeNull();

    const replacedImage = withScale(floor, 0.01);
    replacedImage.data.background = { ...replacedImage.data.background, attachmentId: newId() };
    expect(await reinterpretStored(replacedImage, fake.deps)).toBeNull();

    await fake.deps.source.setStatus(
      fake.withStatus('pending').map((s) => s.id),
      'rejected',
    );
    expect(await reinterpretStored(withScale(floor, 0.01), fake.deps)).toBeNull();
    expect(fake.commits).toHaveLength(1);
  });
});
