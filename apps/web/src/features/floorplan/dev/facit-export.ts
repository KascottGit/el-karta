import type { Id } from '@el-karta/core';
import { FileDown } from 'lucide-react';
import { modelStore } from '@/model/store';
import { readyImageSize } from '../background/images';
import type { Action } from '../canvas/extension';

/** A file-name-safe id from the floor's name, e.g. "Plan 1 – Gotgatan" → "plan-1-gotgatan". */
export const facitId = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'floor';

function download(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

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
  const id = facitId(floor.name);
  const facit = floorToFacit({ id, floor: floor.data, image });
  if (facit) download(`${id}.json`, `${JSON.stringify(facit, null, 2)}\n`);
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
