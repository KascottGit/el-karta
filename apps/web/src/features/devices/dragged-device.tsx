import { useMemo } from 'react';
import { useModelStore } from '@/model/store';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { deviceAppearance } from './appearance';
import { useDraggedDevice } from './device-drag';
import { deviceColor, deviceIssues } from './device-issues';
import { deviceMark } from './device-marks';
import { Footprint, Markers } from './device-shapes';
import { markerStyle } from './marker-style';

/**
 * The device being dragged, where it would be after the drop, drawn on the overlays so the drag
 * redraws only them (see `device-drag.ts`).
 */
export function DraggedDevice({ ctx }: { ctx: CanvasContext }) {
  const floor = useModelStore((s) => s.model?.floors[ctx.floorId]);
  const device = useDraggedDevice(ctx.floorId);
  const mark = useMemo(
    () => (floor && device ? deviceMark(floor.data, device) : null),
    [floor, device],
  );
  const groups = useMemo(() => {
    if (!floor || !mark || mark.footprint) return [];
    const fill = deviceColor(deviceIssues(floor), mark.device);
    return [
      { style: markerStyle(deviceAppearance(mark.device).shape, fill, 'selected'), at: [mark.at] },
    ];
  }, [floor, mark]);
  if (!mark) return null;
  return mark.footprint ? (
    <Footprint corners={mark.footprint} color={deviceAppearance(mark.device).color} selected />
  ) : (
    <Markers groups={groups} />
  );
}
