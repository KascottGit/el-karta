import type { FloorRecord, Id } from '@el-karta/core';
import type { QueryClient } from '@tanstack/react-query';
import { suggestionsStore } from '@/features/suggestions/suggestions-store';
import { SUGGESTIONS_TOOL } from '@/features/suggestions/tool';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import { imageStore } from '../background/images';
import { loadPdfPageSize } from '../background/pdf-page';
import { storageJson } from '../background/project-json';
import { onScaleMeasured, type ScaleMeasured } from '../background/scale-events';
import { SCALE_TOOL } from '../background/tools';
import { canvasPlanImage } from './encode';
import { isAbort, supabaseAiPass } from '@/lib/ai-pass';
import { importErrorCode, ImportError } from './errors';
import {
  commitDrafts,
  interpretReading,
  readPlan,
  reinterpretStored,
  type ImportDeps,
  type Interpreted,
} from './flow';
import { importStore, isBusy, setImportStep } from './import-store';
import type { PlanReading } from './reading';

type Services = Pick<ImportDeps, 'backend' | 'files'> & { planImage: typeof canvasPlanImage };

let services: Services = {
  backend: supabaseAiPass,
  files: storageJson,
  planImage: canvasPlanImage,
};
let queries: QueryClient | null = null;
let abort: AbortController | null = null;

/** Replaces the function, Storage and the canvas, for tests. */
export const setImportServices = (next: Services) => {
  services = next;
};

function deps(): ImportDeps {
  if (!queries) throw new Error('The AI import is not connected to a query client');
  return {
    backend: services.backend,
    files: services.files,
    source: suggestionsStore.getState().source,
    queries,
    newId: () => crypto.randomUUID(),
  };
}

const floorOf = (floorId: Id): FloorRecord => {
  const floor = modelStore.getState().model?.floors[floorId];
  if (!floor?.data.background) throw new ImportError('image');
  return floor;
};

/**
 * Called by the editor while a floor is open: gives the import the query cache to refresh after it
 * stores suggestions, and re-interprets readings when the person sets a scale. Returns the cleanup.
 */
export function connectImport(client: QueryClient): () => void {
  queries = client;
  const off = onScaleMeasured((event) => {
    void handleScaleMeasured(event);
  });
  return () => {
    off();
    if (queries === client) queries = null;
  };
}

/** Runs one step of an import; a failure ends it with its message, a cancel ends it quietly. */
async function step(
  floorId: Id,
  signal: AbortSignal | null,
  work: () => Promise<void>,
  retry: 'read' | 'update' = 'read',
) {
  try {
    await work();
  } catch (error) {
    if (signal?.aborted || isAbort(error)) return;
    setImportStep({ step: 'failed', floorId, error: importErrorCode(error), retry });
  }
}

/** "Tolka planritning med AI": reads the floor's background and stores what it finds as suggestions. */
export async function startImport(floorId: Id) {
  if (isBusy(importStore.getState().current)) return;
  abort = new AbortController();
  const { signal } = abort;
  setImportStep({ step: 'reading', floorId, progress: null });
  await step(floorId, signal, async () => {
    const floor = floorOf(floorId);
    const background = floor.data.background!;
    const image = imageStore.getState()[background.attachmentId];
    if (image?.status !== 'ready') throw new ImportError('image');
    const d = deps();
    const page =
      background.pdfPage === undefined
        ? null
        : await loadPdfPageSize(floor.projectId, background.attachmentId, d.files);
    const reading = await readPlan(
      floor,
      services.planImage(image.image, image.size, page?.widthMm),
      d,
      signal,
      (progress) => {
        setImportStep({ step: 'reading', floorId, progress });
      },
    );
    signal.throwIfAborted();
    const interpreted = interpretReading(reading, floorOf(floorId).data, false, d.newId);
    if (interpreted.interpretation.scale.status === 'none')
      setImportStep({ step: 'ask-scale', floorId, reading });
    else await save(floorId, reading, interpreted);
  });
}

async function save(floorId: Id, reading: PlanReading, interpreted: Interpreted) {
  setImportStep({ step: 'saving', floorId });
  await commitDrafts(
    floorOf(floorId),
    reading,
    interpreted.interpretation.drafts,
    interpreted.placement,
    deps(),
  );
  setImportStep({ step: 'idle' });
  if (editorStore.getState().floorId === floorId) editorStore.getState().setTool(SUGGESTIONS_TOOL);
}

/** "Uppskatta åt mig": the scale comes from objects of standard size, flagged as an estimate. */
export async function estimateScale() {
  const current = importStore.getState().current;
  if (current.step !== 'ask-scale') return;
  const { floorId, reading } = current;
  await step(floorId, null, () =>
    save(floorId, reading, interpretReading(reading, floorOf(floorId).data, true, deps().newId)),
  );
}

/** "Mät ett mått": the import goes on when the scale is set with the scale tool. */
export function measureScale() {
  const current = importStore.getState().current;
  if (current.step !== 'ask-scale') return;
  setImportStep({ step: 'measuring', floorId: current.floorId, reading: current.reading });
  editorStore.getState().setTool(SCALE_TOOL);
}

/** Stops a running import, or dismisses a question or a failure. Nothing has been stored. */
export function cancelImport() {
  const { step: current } = importStore.getState().current;
  if (current === 'saving' || current === 'updating') return;
  abort?.abort();
  abort = null;
  setImportStep({ step: 'idle' });
}

/**
 * A scale set with the scale tool either finishes an import that waits for one, or re-interprets
 * the floor's stored reading if it still has pending suggestions.
 */
export async function handleScaleMeasured(event: ScaleMeasured) {
  const current = importStore.getState().current;
  const { floorId } = event;
  if (
    (current.step === 'ask-scale' || current.step === 'measuring') &&
    current.floorId === floorId
  ) {
    const { reading } = current;
    await step(floorId, null, () =>
      save(floorId, reading, interpretReading(reading, floorOf(floorId).data, false, deps().newId)),
    );
    return;
  }
  if (isBusy(current)) return;
  await updateStored(floorId);
}

async function updateStored(floorId: Id) {
  await step(
    floorId,
    null,
    async () => {
      const changed = await reinterpretStored(floorOf(floorId), deps(), () => {
        setImportStep({ step: 'updating', floorId });
      });
      if (changed !== null) setImportStep({ step: 'idle' });
    },
    'update',
  );
}

/** "Försök igen" after a failure: the same work again, without a new AI read when not needed. */
export async function retryImport() {
  const current = importStore.getState().current;
  if (current.step !== 'failed') return;
  setImportStep({ step: 'idle' });
  if (current.retry === 'update') await updateStored(current.floorId);
  else await startImport(current.floorId);
}
