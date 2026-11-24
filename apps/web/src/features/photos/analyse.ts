import { photoDetectables, type Id } from '@el-karta/core';
import type { Attachment } from '@el-karta/data-supabase';
import type { QueryClient } from '@tanstack/react-query';
import { suggestionsStore } from '@/features/suggestions/suggestions-store';
import { attachmentUrls } from '@/lib/attachments';
import { supabaseAiPass } from '@/lib/ai-pass';
import { modelStore } from '@/model/store';
import { registry } from '@/plugins';
import { analysePhoto, analysisErrorCode, type AnalysisDeps } from './analysis';
import { setAnalysis } from './photos-store';
import { blobPhotoImage } from './request';

type Services = Pick<AnalysisDeps, 'backend' | 'loadPhoto' | 'toImage'>;

async function loadPhoto(photoId: Id): Promise<Blob> {
  const response = await fetch(await attachmentUrls.get(photoId));
  if (!response.ok) {
    attachmentUrls.invalidate(photoId);
    throw new Error(`The photo could not be loaded (${String(response.status)})`);
  }
  return response.blob();
}

let services: Services = { backend: supabaseAiPass, loadPhoto, toImage: blobPhotoImage };

/** Replaces the function, Storage and the canvas, for tests. */
export const setAnalysisServices = (next: Services) => {
  services = next;
};

const detectable = photoDetectables(registry);
let queue: Promise<void> = Promise.resolve();

/**
 * Analyses a photo of the floor and reports its progress in the photos store. Analyses run one
 * after another, so a photo taken while another is read sees that one's suggestions as pending and
 * does not suggest the same devices again. `photos` are the floor's photos, for earlier ones of the
 * same room; `file` is the photo's file when the caller still has it.
 */
export function analyse(
  queries: QueryClient,
  floorId: Id,
  photo: Pick<Attachment, 'id' | 'region'>,
  photos: readonly Attachment[],
  file: Blob | null = null,
): Promise<void> {
  setAnalysis({ step: 'preparing', photoId: photo.id });
  const run = queue.then(async () => {
    const floor = modelStore.getState().model?.floors[floorId];
    if (!floor) return;
    const deps: AnalysisDeps = {
      ...services,
      source: suggestionsStore.getState().source,
      queries,
      detectable,
      newId: () => crypto.randomUUID(),
    };
    try {
      const count = await analysePhoto(
        floor,
        photo,
        photos,
        file,
        deps,
        new AbortController().signal,
        (step) => {
          setAnalysis({ step, photoId: photo.id });
        },
      );
      setAnalysis({ step: 'done', photoId: photo.id, count });
    } catch (error) {
      setAnalysis({ step: 'failed', photoId: photo.id, error: analysisErrorCode(error) });
    }
  });
  queue = run;
  return run;
}
