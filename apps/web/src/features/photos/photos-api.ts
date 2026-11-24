import type { AttachmentRegion, Id } from '@el-karta/core';
import type { Attachment } from '@el-karta/data-supabase';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { modelStore } from '@/model/store';
import {
  attachmentUrls as urls,
  deleteAttachment,
  listAttachments,
  uploadAttachment,
} from '@/lib/attachments';
import { analyse } from './analyse';
import { compressPhoto, PHOTO_EXTENSION, PHOTO_TYPE } from './compress';
import { detachPhoto } from './detach';
import { setUpload } from './photos-store';

export const photosKey = (floorId: Id) => ['photos', floorId] as const;
const urlKey = (photoId: Id) => ['photo-url', photoId] as const;

/** The floor's photos, oldest first. */
export const usePhotos = (floorId: Id) =>
  useQuery({ queryKey: photosKey(floorId), queryFn: () => listAttachments(floorId, 'photo') });

/** A signed URL for showing a photo; `retry` drops it after the image failed to load. */
export function usePhotoUrl(photoId: Id) {
  const query = useQuery({
    queryKey: urlKey(photoId),
    queryFn: () => urls.get(photoId),
    staleTime: 30 * 60_000,
  });
  return {
    url: query.data,
    failed: query.isError,
    retry: () => {
      urls.invalidate(photoId);
      void query.refetch();
    },
  };
}

/**
 * Compresses a picked photo and stores it with what it shows, refreshes the floor's list, and
 * starts analysing it (M11 decision 4). Resolves once it is stored; the analysis reports through
 * the photos store.
 */
export async function uploadPhoto(
  queries: QueryClient,
  file: Blob,
  floorId: Id,
  region: AttachmentRegion,
) {
  const floor = modelStore.getState().model?.floors[floorId];
  if (!floor) return;
  setUpload({ step: 'compressing' });
  let body: Blob;
  try {
    body = await compressPhoto(file);
  } catch {
    setUpload({ step: 'failed', reason: 'image' });
    return;
  }
  setUpload({ step: 'uploading' });
  const id = crypto.randomUUID();
  try {
    await uploadAttachment({
      id,
      projectId: floor.projectId,
      floorId,
      kind: 'photo',
      extension: PHOTO_EXTENSION,
      contentType: PHOTO_TYPE,
      body,
      region,
    });
  } catch {
    setUpload({ step: 'failed', reason: 'upload' });
    return;
  }
  await queries.invalidateQueries({ queryKey: photosKey(floorId) });
  setUpload({ step: 'idle' });
  void analyse(
    queries,
    floorId,
    { id, region },
    queries.getQueryData<Attachment[]>(photosKey(floorId)) ?? [],
    body,
  );
}

/**
 * Deletes the photo, then removes it from the devices that cite it as evidence in one undoable
 * edit. Throws, changing nothing, when the photo cannot be deleted. A file left behind after its
 * row was deleted is unreachable, so the photo counts as deleted.
 */
export async function deletePhoto(queries: QueryClient, photo: Attachment) {
  await deleteAttachment(photo.id);
  const floor =
    photo.floorId === null ? undefined : modelStore.getState().model?.floors[photo.floorId];
  const edit = floor && detachPhoto(floor.data, photo.id);
  if (edit) modelStore.getState().apply(edit);
  if (photo.floorId !== null)
    queries.setQueryData<Attachment[]>(photosKey(photo.floorId), (list) =>
      list?.filter((p) => p.id !== photo.id),
    );
  queries.removeQueries({ queryKey: urlKey(photo.id) });
}

/** Analyses a stored photo again, for instance after the room was changed or a run failed. */
export function reanalysePhoto(queries: QueryClient, photo: Attachment): Promise<void> {
  if (photo.floorId === null) return Promise.resolve();
  const photos = queries.getQueryData<Attachment[]>(photosKey(photo.floorId)) ?? [];
  return analyse(queries, photo.floorId, photo, photos);
}
