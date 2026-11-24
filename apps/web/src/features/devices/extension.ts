import type { EditorExtension } from '@/features/floorplan/canvas/extension';
import { union } from '@/features/floorplan/canvas/rect';
import { DevicePanel } from './device-panel';
import { hasDeviceSelected } from './device-selection';
import { deviceMarks, markBounds } from './device-marks';
import { DevicesLayer } from './devices-layer';
import { deviceMove } from './device-move';
import { DeviceMoveHandles } from './device-move-handles';
import { DraggedDevice } from './dragged-device';

/**
 * Every device on the plan as a generic marker or footprint, selectable, with a read-only panel.
 * Selected wall and ceiling devices can be dragged by their marker.
 * Domains add their own tools and panels on top of it rather than a second device layer.
 */
export const devicesExtension: EditorExtension = {
  id: 'devices',
  layers: [
    {
      id: 'devices',
      // In the model layer, above openings: the overlays layer is redrawn on every pointer move.
      layer: 'openings',
      order: 10,
      Component: DevicesLayer,
      bounds: ({ data }) => union(Object.values(deviceMarks(data)).map(markBounds)),
    },
    { id: 'dragged-device', layer: 'overlays', order: 5, Component: DraggedDevice },
    { id: 'device-move-handles', layer: 'overlays', order: 24, Component: DeviceMoveHandles },
  ],
  handles: [deviceMove],
  panels: [{ id: 'device-props', order: 40, visible: hasDeviceSelected, Component: DevicePanel }],
};
