import { QueryClient } from '@tanstack/react-query';
import type { Attachment, NewAttachment } from '@el-karta/data-supabase';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modelStore } from '@/model/store';
import type * as Compress from './compress';
import { deletePhoto, photosKey, uploadPhoto } from './photos-api';
import { photosStore } from './photos-store';
import { ID, outlet, photo, twoRooms } from './test-fixtures';

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
  photosStore.setState({ upload: { step: 'idle' }, viewing: null });
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
