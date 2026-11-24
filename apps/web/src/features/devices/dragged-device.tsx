import type { Device, FloorData } from '@el-karta/core';
import { useMemo } from 'react';
import { Group } from 'react-konva';
import { useModelStore } from '@/model/store';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { deviceAppearance } from './appearance';
import { useDraggedDevice } from './device-drag';
import { deviceColor, deviceIssues } from './device-issues';
import type { DevicePreview } from './device-tool';
import { deviceMark } from './device-marks';
import { Footprint, Markers } from './device-shapes';
import { markerStyle } from './marker-style';

/**
 * A device that is not (or not yet) where the model has it, such as a drag preview or where a tool
 * would place one: its marker or footprint in `color`, outlined as selected when `selected`.
 */
export function DeviceGhost({
  data,
  device,
  color = deviceAppearance(device).color,
  selected,
}: {
  data: FloorData;
  device: Device;
  color?: string | undefined;
  selected: boolean;
}) {
  const mark = useMemo(() => deviceMark(data, device), [data, device]);
  const groups = useMemo(
    () =>
      mark && !mark.footprint
        ? [
            {
              style: markerStyle(
                deviceAppearance(device).shape,
                color,
                selected ? 'selected' : 'plain',
              ),
              at: [mark.at],
            },
          ]
        : [],
    [mark, device, color, selected],
  );
  if (!mark) return null;
  return mark.footprint ? (
    <Footprint
      corners={mark.footprint}
      color={deviceAppearance(device).color}
      selected={selected}
    />
  ) : (
    <Markers groups={groups} />
  );
}

/** Opacity of where a tool would place a device. */
const PREVIEW_OPACITY = 0.6;

/** Where a device tool would place a device on this floor (`DevicePreview`), faded. */
export function DevicePreviewGhost({
  ctx,
  preview,
}: {
  ctx: CanvasContext;
  preview: DevicePreview | null;
}) {
  const data = useModelStore((s) => s.model?.floors[ctx.floorId]?.data);
  if (!data || preview?.floorId !== ctx.floorId) return null;
  return (
    <Group opacity={PREVIEW_OPACITY} listening={false}>
      <DeviceGhost data={data} device={preview.device} selected={false} />
    </Group>
  );
}

/**
 * The device being dragged, where it would be after the drop, drawn on the overlays so the drag
 * redraws only them (see `device-drag.ts`).
 */
export function DraggedDevice({ ctx }: { ctx: CanvasContext }) {
  const floor = useModelStore((s) => s.model?.floors[ctx.floorId]);
  const device = useDraggedDevice(ctx.floorId);
  const color = useMemo(
    () => (floor && device ? deviceColor(deviceIssues(floor), device) : undefined),
    [floor, device],
  );
  if (!floor || !device) return null;
  return <DeviceGhost data={floor.data} device={device} color={color} selected />;
}
