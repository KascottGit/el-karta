import type { FloorRecord } from '@el-karta/core';
import { FileBraces } from 'lucide-react';
import { modelStore } from '@/model/store';
import type { Action } from '../canvas/extension';
import { downloadJson, fileId } from './download';

/** The file "Exportera våning" downloads: the floor record as stored, named after the floor. */
export const floorExport = (floor: FloorRecord) => ({
  fileName: `${fileId(floor.name)}.json`,
  content: floor,
});

/**
 * Dev-only: downloads the floor as it is stored (a `FloorRecord`), for the photo evals'
 * `evals/photo/floors/<home>.json` (format in `evals/photo/README.md`).
 */
export const exportFloorAction: Action = {
  id: 'dev-export-floor',
  label: 'canvas.dev.exportFloor',
  icon: FileBraces,
  order: 1001,
  enabled: (editor, model) => Boolean(editor.floorId && model.model?.floors[editor.floorId]),
  run: (ctx) => {
    const floor = modelStore.getState().model?.floors[ctx.floorId];
    if (!floor) return;
    const { fileName, content } = floorExport(floor);
    downloadJson(fileName, content);
  },
};
