import type { Id } from '@el-karta/core';
import { FileDown } from 'lucide-react';
import { modelStore } from '@/model/store';
import { readyImageSize } from '../background/images';
import type { Action } from '../canvas/extension';
import { downloadJson, fileId } from './download';

async function exportFacit(floorId: Id) {
  const floor = modelStore.getState().model?.floors[floorId];
  const attachmentId = floor?.data.background?.attachmentId;
  const image = attachmentId ? readyImageSize(attachmentId) : null;
  if (!floor || !image) {
    console.warn('Exportera facit: the background image is not loaded yet');
    return;
  }
  // Loaded on use, so the eval code stays out of the editor's own chunk.
  const { floorToFacit } = await import('@el-karta/evals');
  const id = fileId(floor.name);
  const facit = floorToFacit({ id, floor: floor.data, image });
  if (facit) downloadJson(`${id}.json`, facit);
}

/**
 * Dev-only: downloads the floor as a full facit for `evals/floorplan/facit/` (format in
 * `evals/floorplan/README.md`). Needs a background and a scale.
 */
export const exportFacitAction: Action = {
  id: 'dev-export-facit',
  label: 'canvas.dev.exportFacit',
  icon: FileDown,
  order: 1000,
  enabled: (editor, model) => {
    const data = editor.floorId ? model.model?.floors[editor.floorId]?.data : undefined;
    return Boolean(data?.background && data.scale);
  },
  run: (ctx) => {
    void exportFacit(ctx.floorId);
  },
};
