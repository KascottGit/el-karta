import type { EditorExtension } from '@/features/floorplan/canvas/extension';
import { PhotosPanel } from './photos-panel';
import { PHOTOS_TOOL, photosTool } from './photo-tool';

/** Photos of rooms and walls (M11): the photo tool and its panel. */
export const photosExtension: EditorExtension = {
  id: 'photos',
  tools: [photosTool],
  panels: [
    {
      id: 'photos',
      order: 3,
      visible: (editor) => editor.tool === PHOTOS_TOOL,
      Component: PhotosPanel,
    },
  ],
};
