import { Camera } from 'lucide-react';
import { modelStore } from '@/model/store';
import type { Tool } from '@/features/floorplan/canvas/extension';
import { editorStore } from '@/features/floorplan/editor-store';
import { photosStore, viewPhoto } from './photos-store';
import { photoTapItem } from './target';

export const PHOTOS_TOOL = 'photos';

/**
 * Shows the photo panel; a tap selects the wall or room the photos are of. The selection is the
 * editor's, so a tap in the 3D view picks the target as well.
 */
export const photosTool: Tool = {
  id: PHOTOS_TOOL,
  label: 'photos.tool',
  icon: Camera,
  order: 93,
  shortcut: 'k',
  onTap: (p, ctx) => {
    const floor = modelStore.getState().model?.floors[ctx.floorId];
    if (!floor) return;
    const item = photoTapItem(floor.data, ctx.itemAt(p.screen, p.kind), p.world);
    editorStore.getState().select(item ? [item] : []);
  },
  // While the viewer is open, keys belong to it: Delete must not delete the selected wall.
  onKeyDown: (e) => {
    if (photosStore.getState().viewing === null) return false;
    if (e.key === 'Escape') viewPhoto(null);
    return true;
  },
  onDeactivate: () => {
    viewPhoto(null);
  },
};
