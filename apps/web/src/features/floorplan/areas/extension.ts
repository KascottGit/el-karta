import type { EditorExtension } from '../canvas/extension';
import { union } from '../canvas/rect';
import { AreasLayer } from './areas-layer';
import { areaBounds } from './bounds';

/** Rooms and zones. */
export const areasExtension: EditorExtension = {
  id: 'areas',
  layers: [
    {
      id: 'areas',
      layer: 'areas',
      order: 0,
      Component: AreasLayer,
      bounds: ({ data }) =>
        union([...Object.values(data.rooms), ...Object.values(data.zones)].map(areaBounds)),
    },
  ],
};
