import type { EditorExtension } from '../canvas/extension';
import { union } from '../canvas/rect';
import { wallBounds } from './wall-outline';
import { WallsLayer } from './walls-layer';

/** Walls. */
export const wallsExtension: EditorExtension = {
  id: 'walls',
  layers: [
    {
      id: 'walls',
      layer: 'walls',
      order: 0,
      Component: WallsLayer,
      bounds: ({ data }) => union(Object.values(data.walls).map(wallBounds)),
    },
  ],
};
