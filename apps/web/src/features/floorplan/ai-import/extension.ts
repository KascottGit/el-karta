import { WandSparkles } from 'lucide-react';
import type { EditorExtension } from '../canvas/extension';
import { startImport } from './controller';
import { ImportConnector, ImportPanel } from './import-panel';
import { importOn, importStore, isBusy } from './import-store';

/** "Tolka planritning med AI" (M4 T5): reads the floor's background into pending suggestions. */
export const aiImportExtension: EditorExtension = {
  id: 'ai-import',
  actions: [
    {
      id: 'ai-import',
      label: 'ai.import.action',
      icon: WandSparkles,
      order: 50,
      enabled: (editor, model) =>
        editor.floorId !== null &&
        Boolean(model.model?.floors[editor.floorId]?.data.background) &&
        !isBusy(importStore.getState().current),
      run: (ctx) => {
        void startImport(ctx.floorId);
      },
    },
  ],
  layers: [{ id: 'ai-import', layer: 'overlays', order: 100, Component: ImportConnector }],
  panels: [
    {
      id: 'ai-import',
      order: 2,
      visible: (editor) => importOn(editor.floorId).step !== 'idle',
      Component: ImportPanel,
    },
  ],
};
