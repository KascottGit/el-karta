import { PHOTO_QUALITY } from '@el-karta/ai-passes';
import { applyEdit } from '@el-karta/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modelStore } from '@/model/store';
import { editorStore } from '@/features/floorplan/editor-store';
import { pointer, pt, testCtx } from '@/features/floorplan/walls/test-fixtures';
import { compressPhoto, type PhotoCodec } from './compress';
import { detachPhoto } from './detach';
import { photoGroups } from './groups';
import { photosTool } from './photo-tool';
import { photosStore, viewPhoto } from './photos-store';
import { photoRegion, photoTapItem, photoTarget, targetRoom } from './target';
import { ID, outlet, photo, twoRooms } from './test-fixtures';

const { model, floorId } = twoRooms();
const data = model.floors[floorId]!.data;

describe('photoTarget', () => {
  it('targets a selected room', () => {
    const target = photoTarget(data, [{ collection: 'rooms', id: ID.kitchen }]);
    expect(target).toEqual({ kind: 'room', roomId: ID.kitchen });
    expect(photoRegion(target)).toEqual({ roomId: ID.kitchen });
  });

  it('targets a wall with its one room, and the side facing it', () => {
    const target = photoTarget(data, [{ collection: 'walls', id: ID.outer }]);
    expect(target).toEqual({
      kind: 'wall',
      wallId: ID.outer,
      rooms: [{ roomId: ID.kitchen, side: 'right' }],
    });
    expect(photoRegion(target)).toEqual({ roomId: ID.kitchen, wallId: ID.outer });
  });

  it('offers both rooms of a wall between two, defaulting to the first', () => {
    const target = photoTarget(data, [{ collection: 'walls', id: ID.shared }]);
    expect(target.kind === 'wall' && target.rooms.map((r) => r.roomId).sort()).toEqual(
      [ID.kitchen, ID.hall].sort(),
    );
    const first = target.kind === 'wall' ? target.rooms[0]!.roomId : '';
    const second = target.kind === 'wall' ? target.rooms[1]!.roomId : '';
    expect(photoRegion(target)).toEqual({ roomId: first, wallId: ID.shared });
    expect(photoRegion(target, second)).toEqual({ roomId: second, wallId: ID.shared });
    // A choice made for another wall does not apply.
    expect(targetRoom(target, '00000000-0000-4000-8000-0000000000aa')).toBe(first);
  });

  it('has no region for a wall in no room', () => {
    const target = photoTarget(data, [{ collection: 'walls', id: ID.loose }]);
    expect(target).toEqual({ kind: 'wall', wallId: ID.loose, rooms: [] });
    expect(photoRegion(target)).toBeNull();
  });

  it('targets nothing without exactly one selected room or wall', () => {
    expect(photoTarget(data, [])).toEqual({ kind: 'none' });
    expect(
      photoTarget(data, [
        { collection: 'rooms', id: ID.kitchen },
        { collection: 'walls', id: ID.outer },
      ]),
    ).toEqual({ kind: 'none' });
    expect(photoTarget(data, [{ collection: 'devices', id: ID.kitchen }])).toEqual({
      kind: 'none',
    });
    expect(photoTarget(data, [{ collection: 'rooms', id: ID.shared }])).toEqual({ kind: 'none' });
    expect(photoRegion({ kind: 'none' })).toBeNull();
  });
});

describe('photo tool', () => {
  let loadedId = '';
  beforeEach(() => {
    const project = twoRooms();
    loadedId = project.floorId;
    modelStore.getState().load(project.model, { discardUnsaved: true });
    editorStore.getState().openFloor(loadedId);
    editorStore.getState().select([]);
  });

  it('keeps a wall or room hit, and otherwise picks the room under the pointer', () => {
    const wallHit = { collection: 'walls' as const, id: ID.outer };
    expect(photoTapItem(data, wallHit, pt(1, 0))).toEqual(wallHit);
    const deviceHit = { collection: 'devices' as const, id: 'x' };
    expect(photoTapItem(data, deviceHit, pt(5, 1))).toEqual({ collection: 'rooms', id: ID.hall });
    expect(photoTapItem(data, null, pt(20, 20))).toBeNull();
  });

  it('selects what it taps, in the shared selection', () => {
    const ctx = {
      ...testCtx(loadedId),
      itemAt: () => ({ collection: 'walls' as const, id: ID.shared }),
    };
    photosTool.onTap!(pointer(pt(4, 1), { kind: 'touch' }), ctx);
    expect(editorStore.getState().selection).toEqual([{ collection: 'walls', id: ID.shared }]);
    photosTool.onTap!(pointer(pt(1, 1)), testCtx(loadedId));
    expect(editorStore.getState().selection).toEqual([{ collection: 'rooms', id: ID.kitchen }]);
    photosTool.onTap!(pointer(pt(20, 20)), testCtx(loadedId));
    expect(editorStore.getState().selection).toEqual([]);
  });

  it('keeps keys from the editor while the viewer is open, and closes it on Escape', () => {
    const key = (k: string) =>
      photosTool.onKeyDown!({ key: k } as KeyboardEvent, testCtx(loadedId));
    viewPhoto(null);
    expect(key('Delete')).toBe(false);
    viewPhoto('00000000-0000-4000-8000-0000000000a1');
    expect(key('Delete')).toBe(true);
    expect(photosStore.getState().viewing).not.toBeNull();
    expect(key('Escape')).toBe(true);
    expect(photosStore.getState().viewing).toBeNull();
    viewPhoto('00000000-0000-4000-8000-0000000000a1');
    photosTool.onDeactivate!(testCtx(loadedId));
    expect(photosStore.getState().viewing).toBeNull();
  });
});

describe('compressPhoto', () => {
  const codec = (width: number, height: number) => {
    const bitmap = { width, height, close: vi.fn() };
    const out = new Blob(['jpeg']);
    const fake = {
      decode: vi.fn<PhotoCodec['decode']>(() => Promise.resolve(bitmap as unknown as ImageBitmap)),
      encode: vi.fn<PhotoCodec['encode']>(() => Promise.resolve(out)),
    };
    return { fake, bitmap, out };
  };

  it('decodes upright by EXIF orientation and shrinks a portrait photo to 2048 px on its long side', async () => {
    // A phone photo stored as 4032 × 3024 with orientation 6 decodes upright as 3024 × 4032.
    const { fake, bitmap, out } = codec(3024, 4032);
    const file = new Blob(['raw']);
    expect(await compressPhoto(file, fake)).toBe(out);
    expect(fake.decode).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    const [source, region, scale, type, quality] = fake.encode.mock.calls[0]!;
    expect(source).toBe(bitmap);
    expect(region).toEqual({ x: 0, y: 0, width: 3024, height: 4032 });
    expect([Math.round(region.width * scale), Math.round(region.height * scale)]).toEqual([
      1536, 2048,
    ]);
    expect([type, quality]).toEqual(['image/jpeg', PHOTO_QUALITY]);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('never enlarges a small photo, and frees the bitmap when encoding fails', async () => {
    const small = codec(800, 600);
    await compressPhoto(new Blob(['raw']), small.fake);
    expect(small.fake.encode.mock.calls[0]![2]).toBe(1);

    const failing = codec(4000, 3000);
    failing.fake.encode.mockRejectedValueOnce(new Error('no canvas'));
    await expect(compressPhoto(new Blob(['raw']), failing.fake)).rejects.toThrow('no canvas');
    expect(failing.bitmap.close).toHaveBeenCalled();
  });
});

describe('detachPhoto', () => {
  const photoId = '00000000-0000-4000-8000-0000000000a1';
  const otherId = '00000000-0000-4000-8000-0000000000a2';

  it('removes the photo from every device citing it in one edit, dropping empty lists', () => {
    const project = twoRooms();
    const devices = project.model.floors[project.floorId]!.data.devices;
    const only = outlet('00000000-0000-4000-8000-0000000000d1', [photoId]);
    const both = outlet('00000000-0000-4000-8000-0000000000d2', [otherId, photoId]);
    const unrelated = outlet('00000000-0000-4000-8000-0000000000d3', [otherId]);
    const bare = outlet('00000000-0000-4000-8000-0000000000d4');
    for (const d of [only, both, unrelated, bare]) devices[d.id] = d;

    const edit = detachPhoto(project.model.floors[project.floorId]!.data, photoId)!;
    const { model: next, patches } = applyEdit(project.model, edit);
    const after = next.floors[project.floorId]!.data.devices;
    expect(after[only.id]).toEqual(outlet(only.id));
    expect('attachmentIds' in after[only.id]!).toBe(false);
    expect(after[both.id]!.attachmentIds).toEqual([otherId]);
    expect(after[unrelated.id]).toBe(devices[unrelated.id]);
    expect(after[bare.id]).toBe(devices[bare.id]);
    expect(new Set(patches.map((p) => p.path[4]))).toEqual(new Set([only.id, both.id]));

    modelStore.getState().load(project.model, { discardUnsaved: true });
    modelStore.getState().apply(edit);
    expect(modelStore.getState().past).toHaveLength(1);
    modelStore.getState().undo();
    expect(modelStore.getState().model!.floors[project.floorId]!.data.devices[only.id]).toEqual(
      only,
    );
  });

  it('gives no edit when no device cites the photo', () => {
    expect(detachPhoto(data, photoId)).toBeNull();
  });
});

describe('photoGroups', () => {
  const p = (n: number, region: Parameters<typeof photo>[2]) =>
    photo(`00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, floorId, region);

  it('groups the room’s photos by wall, the target wall first and the room in general last', () => {
    const general = p(1, { roomId: ID.kitchen });
    const ofShared = p(2, { roomId: ID.kitchen, wallId: ID.shared });
    const ofOuter = p(3, { roomId: ID.kitchen, wallId: ID.outer });
    const fromHall = p(4, { roomId: ID.hall, wallId: ID.shared });
    const noRegion = p(5, null);
    const all = [general, ofShared, ofOuter, fromHall, noRegion];

    expect(photoGroups(all, ID.kitchen, ID.outer)).toEqual([
      { wallId: ID.outer, photos: [ofOuter] },
      { wallId: ID.shared, photos: [ofShared] },
      { wallId: null, photos: [general] },
    ]);
    expect(photoGroups(all, ID.hall, ID.shared)).toEqual([
      { wallId: ID.shared, photos: [fromHall] },
    ]);
  });

  it('always shows the target wall, even before its first photo', () => {
    expect(photoGroups([], ID.kitchen, ID.outer)).toEqual([{ wallId: ID.outer, photos: [] }]);
    expect(photoGroups([], ID.kitchen)).toEqual([]);
  });
});
