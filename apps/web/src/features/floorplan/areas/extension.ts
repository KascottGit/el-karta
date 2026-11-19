import type { EditorExtension } from '../canvas/extension';
import { union } from '../canvas/rect';
import { midpointHandle, vertexHandle } from './area-handles';
import { AreaDrafts, AreaHandles } from './area-overlays';
import { RoomPanel, ZonePanel } from './area-panel';
import { fillRoomTool, roomTool, zoneTool } from './area-tools';
import { AreasLayer } from './areas-layer';
import { areaBounds } from './bounds';
import { hasRoomSelected, hasZoneSelected } from './selected-area';

/** Rooms and zones: drawing, filling rooms from walls, reshaping and their side panels. */
export const areasExtension: EditorExtension = {
  id: 'areas',
  tools: [roomTool, fillRoomTool, zoneTool],
  handles: [vertexHandle, midpointHandle],
  layers: [
    {
      id: 'areas',
      layer: 'areas',
      order: 0,
      Component: AreasLayer,
      bounds: ({ data }) =>
        union([...Object.values(data.rooms), ...Object.values(data.zones)].map(areaBounds)),
    },
    { id: 'area-drafts', layer: 'overlays', order: 10, Component: AreaDrafts },
    { id: 'area-handles', layer: 'overlays', order: 20, Component: AreaHandles },
  ],
  panels: [
    { id: 'room-props', order: 20, visible: hasRoomSelected, Component: RoomPanel },
    { id: 'zone-props', order: 21, visible: hasZoneSelected, Component: ZonePanel },
  ],
};
