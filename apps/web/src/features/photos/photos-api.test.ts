import { QueryClient } from '@tanstack/react-query';
import type { Attachment, NewAttachment } from '@el-karta/data-supabase';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhotoInput } from '@el-karta/ai-passes';
import type { Device } from '@el-karta/core';
import { fakeBackend } from '@/features/floorplan/ai-import/fixtures';
import { setSuggestionSource } from '@/features/suggestions/suggestions-store';
import { modelStore } from '@/model/store';
import { setAnalysisServices } from './analyse';
import type * as Compress from './compress';
import { deletePhoto, photosKey, reanalysePhoto, uploadPhoto } from './photos-api';
import { photosStore, type PhotoAnalysis } from './photos-store';
import { ID, outlet, photo, photoReply, twoRooms } from './test-fixtures';

const server = vi.hoisted(() => ({
  uploaded: [] as NewAttachment[],
  deleted: [] as string[],
  failDelete: false,
  failFile: false,
  failUpload: false,
}));

vi.mock('@/lib/attachments', () => ({
  uploadAttachment: (a: NewAttachment) => {
    if (server.failUpload) return Promise.reject(new Error('offline'));
    server.uploaded.push(a);
    return Promise.resolve({ storagePath: 'x' });
  },
  deleteAttachment: (id: string) => {
    if (server.failDelete) return Promise.reject(new Error('not allowed'));
    server.deleted.push(id);
    return Promise.resolve({ fileRemoved: !server.failFile });
  },
  listAttachments: () => Promise.resolve([]),
  attachmentUrls: { get: () => Promise.reject(new Error('unused')), invalidate: () => undefined },
}));

const compressed = new Blob(['small jpeg']);
const compress = vi.hoisted(() => ({ fail: false }));
vi.mock('./compress', async (original) => ({
  ...(await original<typeof Compress>()),
  compressPhoto: () =>
    compress.fail ? Promise.reject(new Error('not an image')) : Promise.resolve(compressed),
}));

let floorId = '';
const photoId = '00000000-0000-4000-8000-0000000000a1';
const deviceId = '00000000-0000-4000-8000-0000000000d1';

beforeEach(() => {
  Object.assign(server, {
    uploaded: [],
    deleted: [],
    failDelete: false,
    failFile: false,
    failUpload: false,
  });
  compress.fail = false;
  const project = twoRooms();
  floorId = project.floorId;
  project.model.floors[floorId]!.data.devices[deviceId] = outlet(deviceId, [photoId]);
  modelStore.getState().load(project.model, { discardUnsaved: true });
  photosStore.setState({ upload: { step: 'idle' }, analysis: { step: 'idle' }, viewing: null });
  fake().stop();
});

function fake() {
  const backend = fakeBackend(() => Promise.resolve(photoReply()));
  const loaded: string[] = [];
  setAnalysisServices({
    backend: backend.deps.backend,
    loadPhoto: (id) => {
      loaded.push(id);
      return Promise.resolve(new Blob([id]));
    },
    toImage: (blob) => ({ encode: async () => btoa(await blob.text()) }),
  });
  setSuggestionSource(backend.deps.source);
  const steps: PhotoAnalysis['step'][] = [];
  const stop = photosStore.subscribe((s) => steps.push(s.analysis.step));
  return { ...backend, loaded, steps, stop };
}
const settled = () =>
  vi.waitFor(() => {
    expect(['done', 'failed']).toContain(photosStore.getState().analysis.step);
  });

describe('uploadPhoto', () => {
  it('stores the compressed photo as a JPEG photo attachment with its region and refreshes the list', async () => {
    const queries = new QueryClient();
    queries.setQueryData(photosKey(floorId), []);
    const region = { roomId: ID.kitchen, wallId: ID.outer };
    await uploadPhoto(queries, new Blob(['raw']), floorId, region);
    expect(server.uploaded).toEqual([
      expect.objectContaining({
        projectId: modelStore.getState().model!.floors[floorId]!.projectId,
        floorId,
        kind: 'photo',
        extension: 'jpg',
        contentType: 'image/jpeg',
        body: compressed,
        region,
      }),
    ]);
    expect(queries.getQueryState(photosKey(floorId))?.isInvalidated).toBe(true);
    expect(photosStore.getState().upload).toEqual({ step: 'idle' });
    await settled();
  });

  it('reports a file that is not an image, and a failed upload', async () => {
    const queries = new QueryClient();
    compress.fail = true;
    await uploadPhoto(queries, new Blob(['raw']), floorId, { roomId: ID.kitchen });
    expect(photosStore.getState().upload).toEqual({ step: 'failed', reason: 'image' });
    compress.fail = false;
    server.failUpload = true;
    await uploadPhoto(queries, new Blob(['raw']), floorId, { roomId: ID.kitchen });
    expect(photosStore.getState().upload).toEqual({ step: 'failed', reason: 'upload' });
    expect(server.uploaded).toEqual([]);
  });
});

describe('analysing photos', () => {
  it('starts once the photo is stored, with its compressed file, and reports each step', async () => {
    const { runs, commits, loaded, steps, stop } = fake();
    const queries = new QueryClient();
    const region = { roomId: ID.kitchen, wallId: ID.outer };
    await uploadPhoto(queries, new Blob(['raw']), floorId, region);
    await settled();
    stop();

    const id = server.uploaded[0]!.id;
    expect(loaded).toEqual([]);
    expect((runs[0]!.input as PhotoInput).image.data).toBe(btoa('small jpeg'));
    expect(steps.filter((s, i) => s !== 'idle' && s !== steps[i - 1])).toEqual([
      'preparing',
      'reading',
      'saving',
      'done',
    ]);
    // The outlet already on the wall at 1 m is not suggested again.
    expect(photosStore.getState().analysis).toEqual({ step: 'done', photoId: id, count: 2 });
    for (const s of commits[0]!.suggestions)
      expect((s.payload as Device).attachmentIds).toEqual([id]);
  });

  it('analyses a stored photo again from its file, and reports a failure by its code', async () => {
    const { runs, loaded, stop } = fake();
    const queries = new QueryClient();
    const stored = photo(photoId, floorId, { roomId: ID.kitchen, wallId: ID.outer });
    await reanalysePhoto(queries, stored);
    stop();
    expect(loaded).toEqual([photoId]);
    expect(runs).toHaveLength(1);
    expect(photosStore.getState().analysis).toEqual({ step: 'done', photoId, count: 2 });

    await reanalysePhoto(queries, { ...stored, region: { roomId: crypto.randomUUID() } });
    expect(photosStore.getState().analysis).toEqual({
      step: 'failed',
      photoId,
      error: 'no_room',
    });
  });

  it('runs one analysis at a time, so the second photo of a wall sees the first one’s suggestions', async () => {
    const { commits, stop } = fake();
    const queries = new QueryClient();
    const region = { roomId: ID.kitchen, wallId: ID.outer };
    const first = photo(photoId, floorId, region);
    const second = photo(crypto.randomUUID(), floorId, region);
    await Promise.all([reanalysePhoto(queries, first), reanalysePhoto(queries, second)]);
    stop();
    expect(commits).toHaveLength(1);
    expect(photosStore.getState().analysis).toMatchObject({ step: 'done', count: 0 });
  });
});

describe('deletePhoto', () => {
  const stored = (): Attachment =>
    photo(photoId, floorId, { roomId: ID.kitchen, wallId: ID.outer });
  const device = () => modelStore.getState().model!.floors[floorId]!.data.devices[deviceId]!;

  it('deletes the photo, removes it from devices in one undoable edit and from the list', async () => {
    const queries = new QueryClient();
    queries.setQueryData(photosKey(floorId), [stored()]);
    await deletePhoto(queries, stored());
    expect(server.deleted).toEqual([photoId]);
    expect(device().attachmentIds).toBeUndefined();
    expect(modelStore.getState().past).toHaveLength(1);
    expect(queries.getQueryData(photosKey(floorId))).toEqual([]);
  });

  it('counts the photo as deleted when only its file could not be removed', async () => {
    const queries = new QueryClient();
    queries.setQueryData(photosKey(floorId), [stored()]);
    server.failFile = true;
    await deletePhoto(queries, stored());
    expect(device().attachmentIds).toBeUndefined();
    expect(queries.getQueryData(photosKey(floorId))).toEqual([]);
  });

  it('changes nothing when the photo cannot be deleted', async () => {
    const queries = new QueryClient();
    queries.setQueryData(photosKey(floorId), [stored()]);
    server.failDelete = true;
    await expect(deletePhoto(queries, stored())).rejects.toThrow();
    expect(device().attachmentIds).toEqual([photoId]);
    expect(modelStore.getState().past).toHaveLength(0);
    expect(queries.getQueryData(photosKey(floorId))).toEqual([stored()]);
  });
});
