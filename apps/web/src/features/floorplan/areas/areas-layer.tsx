import { centroid, type Pt, type Room, type Zone } from '@el-karta/core';
import type Konva from 'konva';
import { memo, useMemo } from 'react';
import { Line } from 'react-konva';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '../editor-store';
import { createCuller } from '../canvas/culling';
import type { CanvasContext } from '../canvas/extension';
import { selectable } from '../canvas/hit';
import { boundsOf, width } from '../canvas/rect';
import { ScreenLabel } from '../canvas/screen-label';
import { selectedIds } from '../canvas/selection';
import { canvasColors } from '../canvas/theme';
import { useRenderWindow } from '../canvas/use-render-window';
import { areaBounds } from './bounds';

const areaColors = {
  room: '#f8fafc',
  roomStroke: '#cbd5e1',
  zone: 'rgba(16, 185, 129, 0.10)',
  zoneStroke: '#10b981',
} as const;

const cullAreas = createCuller(areaBounds);

/** Read-only rooms with name labels, and translucent zones over them. */
export function AreasLayer({ ctx }: { ctx: CanvasContext }) {
  const data = useModelStore((s) => s.model?.floors[ctx.floorId]?.data);
  const rooms = data?.rooms;
  const zones = data?.zones;
  const { rect: view, scale } = useRenderWindow();
  const selection = useEditorStore((s) => s.selection);
  const visibleRooms = useMemo(() => (rooms ? cullAreas(rooms, view) : []), [rooms, view]);
  const visibleZones = useMemo(() => (zones ? cullAreas(zones, view) : []), [zones, view]);
  const selectedRooms = useMemo(() => selectedIds(selection, 'rooms'), [selection]);
  const selectedZones = useMemo(() => selectedIds(selection, 'zones'), [selection]);

  return (
    <>
      {visibleRooms.map((room) => (
        <RoomShape
          key={room.id}
          room={room}
          selected={selectedRooms.has(room.id)}
          labelScale={scale}
        />
      ))}
      {visibleZones.map((zone) => (
        <ZoneShape key={zone.id} zone={zone} selected={selectedZones.has(zone.id)} />
      ))}
    </>
  );
}

const flat = (polygon: readonly Pt[]) => polygon.flatMap((p) => [p.x, p.y]);

const RoomShape = memo(function RoomShape({
  room,
  selected,
  labelScale,
}: {
  room: Room;
  selected: boolean;
  labelScale: number;
}) {
  const points = useMemo(() => flat(room.polygon), [room.polygon]);
  const label = useMemo(() => {
    const bounds = boundsOf(room.polygon);
    return { at: centroid(room.polygon), width: bounds ? 0.9 * width(bounds) : 0 };
  }, [room.polygon]);
  return (
    <>
      <Line
        {...selectable('rooms', room.id)}
        points={points}
        closed
        fill={selected ? canvasColors.selectedFill : areaColors.room}
        stroke={selected ? canvasColors.selected : areaColors.roomStroke}
        strokeWidth={1}
        strokeScaleEnabled={false}
        perfectDrawEnabled={false}
      />
      <ScreenLabel text={room.name} at={label.at} maxWidth={label.width} scale={labelScale} />
    </>
  );
});

// Zones overlap rooms, so they are picked by their outline only and taps inside reach the room.
const outlineHit = (points: number[]) => (context: Konva.Context, shape: Konva.Shape) => {
  context.beginPath();
  context.moveTo(points[0] ?? 0, points[1] ?? 0);
  for (let i = 2; i < points.length; i += 2) context.lineTo(points[i]!, points[i + 1]!);
  context.closePath();
  context.strokeShape(shape);
};

const ZoneShape = memo(function ZoneShape({ zone, selected }: { zone: Zone; selected: boolean }) {
  const points = useMemo(() => flat(zone.polygon), [zone.polygon]);
  const hitFunc = useMemo(() => outlineHit(points), [points]);
  return (
    <Line
      {...selectable('zones', zone.id)}
      points={points}
      closed
      fill={areaColors.zone}
      stroke={selected ? canvasColors.selected : areaColors.zoneStroke}
      strokeWidth={selected ? 2 : 1}
      dash={[6, 4]}
      strokeScaleEnabled={false}
      hitStrokeWidth={8}
      hitFunc={hitFunc}
      perfectDrawEnabled={false}
    />
  );
});
