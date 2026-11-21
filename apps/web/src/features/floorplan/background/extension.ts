import { backgroundPlacement } from '@el-karta/core';
import type { EditorExtension } from '../canvas/extension';
import { BackgroundLayer } from './background-layer';
import { BackgroundHandles, ScaleMeasurement } from './background-overlay';
import { BackgroundPanel } from './background-panel';
import { readyImageSize } from './images';
import { imageBounds } from './plan-file';
import { ScaleNotice } from './scale-notice';
import { ScalePanel } from './scale-panel';
import {
  BACKGROUND_TOOL,
  backgroundTool,
  measureEndHandle,
  moveHandle,
  rotateHandle,
  SCALE_TOOL,
  scaleTool,
} from './tools';

/** The floor's plan image: upload, placement, opacity and the scale tool. */
export const backgroundExtension: EditorExtension = {
  id: 'background',
  tools: [backgroundTool, scaleTool],
  handles: [moveHandle, rotateHandle, measureEndHandle],
  layers: [
    {
      id: 'background-image',
      layer: 'background',
      order: 0,
      Component: BackgroundLayer,
      bounds: ({ data }) => {
        const placement = backgroundPlacement(data.background, data.scale);
        const size = data.background && readyImageSize(data.background.attachmentId);
        return placement && size ? imageBounds(placement, size) : null;
      },
    },
    { id: 'background-handles', layer: 'overlays', order: 10, Component: BackgroundHandles },
    { id: 'scale-measurement', layer: 'overlays', order: 11, Component: ScaleMeasurement },
  ],
  panels: [
    {
      id: 'background',
      order: 90,
      visible: (editor) => editor.tool === BACKGROUND_TOOL,
      Component: BackgroundPanel,
    },
    {
      id: 'scale',
      order: 91,
      visible: (editor) => editor.tool === SCALE_TOOL,
      Component: ScalePanel,
    },
    {
      id: 'scale-notice',
      order: 1,
      visible: (editor, { model }) =>
        editor.tool !== SCALE_TOOL &&
        editor.floorId !== null &&
        model?.floors[editor.floorId]?.data.scale?.source === 'ai_estimate',
      Component: ScaleNotice,
    },
  ],
};
