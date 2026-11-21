import { setBackground, setScale, type Model } from '@el-karta/core';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSuggestionSource } from '@/features/suggestions/suggestions-store';
import { SUGGESTIONS_TOOL } from '@/features/suggestions/tool';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import { imageStore } from '../background/images';
import { savePdfPageSize } from '../background/pdf-page';
import { emitScaleMeasured } from '../background/scale-events';
import { SCALE_TOOL } from '../background/tools';
import {
  cancelImport,
  connectImport,
  estimateScale,
  measureScale,
  setImportServices,
  startImport,
} from './controller';
import {
  fakeBackend,
  fakeImage,
  floorWithBackground,
  planReply,
  TRUE_METRES_PER_PIXEL,
} from './fixtures';
import { readPlan } from './flow';
import { importStore, setImportStep } from './import-store';

async function setup(reply?: Parameters<typeof fakeBackend>[0]) {
  const floor = floorWithBackground();
  const model: Model = {
    project: {
      id: floor.projectId,
      name: 'Test',
      kind: 'home',
      version: 1,
      data: {
        schemaVersion: floor.data.schemaVersion,
        buildings: { [floor.buildingId]: { id: floor.buildingId, name: 'Hus' } },
        crossFloorConnections: {},
      },
    },
    floors: { [floor.id]: floor },
  };
  modelStore.getState().load(model, { discardUnsaved: true });
  editorStore.getState().openFloor(floor.id);
  editorStore.getState().setTool('select');
  const fake = fakeBackend(reply);
  setImportServices({
    backend: fake.deps.backend,
    files: fake.files,
    planImage: (_source, _size, pdfPageWidthMm) => fakeImage(pdfPageWidthMm),
  });
  setSuggestionSource(fake.deps.source);
  disconnect = connectImport(new QueryClient());
  const reading = await readPlan(
    floor,
    fakeImage(),
    fakeBackend().deps,
    new AbortController().signal,
    () => {},
  );
  setImportStep({ step: 'ask-scale', floorId: floor.id, reading });
  const measure = (metresPerPixel: number) => {
    const scale = { source: 'user' as const, metresPerPixel };
    modelStore.getState().apply(setScale(floor.id, scale));
    emitScaleMeasured({ floorId: floor.id, scale, growth: 1, pivot: { x: 0, y: 0 } });
  };
  return { floor, fake, measure, reading };
}

/** The floor's background as a loaded image, as the background layer leaves it. */
function showImage(attachmentId: string) {
  imageStore.setState({
    [attachmentId]: {
      status: 'ready',
      image: {} as HTMLImageElement,
      size: { width: 800, height: 600 },
    },
  });
}

let disconnect = () => {};
afterEach(() => {
  disconnect();
  setImportStep({ step: 'idle' });
});

const step = () => importStore.getState().current.step;

describe('import controller', () => {
  it('"Mät ett mått" waits for the scale tool, then stores suggestions at that scale and opens the review', async () => {
    const { fake, measure } = await setup();
    measureScale();
    expect(step()).toBe('measuring');
    expect(editorStore.getState().tool).toBe(SCALE_TOOL);
    expect(fake.commits).toHaveLength(0);

    measure(TRUE_METRES_PER_PIXEL);
    await vi.waitFor(() => {
      expect(step()).toBe('idle');
    });
    expect(editorStore.getState().tool).toBe(SUGGESTIONS_TOOL);
    const [commit] = fake.commits;
    expect(commit!.suggestions.some((d) => d.kind === 'scale')).toBe(false);
    expect(commit!.suggestions.every((d) => d.requires.every((r) => fake.rows.has(r)))).toBe(true);
  });

  it('"Uppskatta åt mig" stores an estimated scale; a scale measured later replaces what is pending', async () => {
    const { fake, measure } = await setup();
    await estimateScale();
    expect(step()).toBe('idle');
    const first = fake.withStatus('pending');
    const scale = first.find((s) => s.kind === 'scale')!;
    expect(scale.payload).toMatchObject({ source: 'ai_estimate' });

    measure(TRUE_METRES_PER_PIXEL * 1.1);
    await vi.waitFor(() => {
      expect(fake.commits).toHaveLength(2);
    });
    await vi.waitFor(() => {
      expect(step()).toBe('idle');
    });
    for (const s of first) expect(fake.rows.get(s.id)!.status).toBe('rejected');
    expect(fake.withStatus('pending').some((s) => s.kind === 'scale')).toBe(false);
  });

  it('a scale measured with nothing pending changes nothing', async () => {
    const { fake, measure } = await setup();
    cancelImport();
    measure(0.01);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(step()).toBe('idle');
    expect(fake.commits).toHaveLength(0);
  });

  it('reads the loaded image with its PDF page width and asks for a scale when none is printed', async () => {
    const { floor, fake } = await setup();
    cancelImport();
    const background = { ...floor.data.background!, pdfPage: 1 };
    modelStore.getState().apply(setBackground(floor.id, background));
    showImage(background.attachmentId);
    await savePdfPageSize(
      floor.projectId,
      background.attachmentId,
      { widthMm: 297, heightMm: 210 },
      fake.files,
    );

    await startImport(floor.id);
    const current = importStore.getState().current;
    expect(current.step).toBe('ask-scale');
    expect(current.step === 'ask-scale' && current.reading.pdfPageWidthMm).toBe(297);
    expect(fake.runs.map((r) => r.pass)).toEqual(['floorplan-locate', 'floorplan']);
    expect(fake.commits).toHaveLength(0);
  });

  it('cancelling a running import stops it at once and a late answer changes nothing', async () => {
    let answer = () => {};
    const { floor, fake } = await setup(
      () =>
        new Promise((resolve) => {
          answer = () => {
            resolve(planReply());
          };
        }),
    );
    cancelImport();
    showImage(floor.data.background!.attachmentId);

    const started = startImport(floor.id);
    await vi.waitFor(() => {
      expect(fake.runs).toHaveLength(1);
    });
    expect(step()).toBe('reading');
    cancelImport();
    expect(step()).toBe('idle');
    answer();
    await started;
    expect(step()).toBe('idle');
    expect(fake.runs).toHaveLength(1);
    expect(fake.commits).toHaveLength(0);
  });

  it('shows a missing image as a failure, not as a crash', async () => {
    const { floor } = await setup();
    cancelImport();
    imageStore.setState({}, true);
    await startImport(floor.id);
    expect(importStore.getState().current).toEqual({
      step: 'failed',
      floorId: floor.id,
      error: 'image',
    });
  });

  it('cancelling the question stores nothing', async () => {
    const { fake } = await setup();
    cancelImport();
    expect(step()).toBe('idle');
    await estimateScale();
    expect(fake.commits).toHaveLength(0);
    expect(fake.files.files.size).toBe(0);
  });
});
