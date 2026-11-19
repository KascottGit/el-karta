import { centroid, type Pt, type Room, type Zone } from '@el-karta/core';
import { memo, useMemo } from 'react';
import { Line, Text } from 'react-konva';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '../../editor-store';
import { createCuller } from '../culling';
import type { CanvasContext } from '../extension';
import { selectable } from '../hit';
import { boundsOf, width } from '../rect';
import { selectedIds } from '../selection';
import { canvasColors, canvasFont } from '../theme';

const cullAreas = createCuller((area: { polygon: readonly Pt[] }) => boundsOf(area.polygon));
const LABEL_PX = 12;
const MIN_LABEL_WIDTH_PX = 40;

/** Read-only rooms with name labels, and translucent zones over them. */
export function AreasLayer({ ctx }: { ctx: CanvasContext }) {
  const data = useModelStore((s) => s.model?.floors[ctx.floorId]?.data);
  const rooms = data?.rooms;
  const zones = data?.zones;
  const { rect: view, scale } = useEditorStore((s) => s.renderWindow);
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
  const label = useMemo(
    () => ({
      at: centroid(room.polygon),
      width: 0.9 * (room.polygon.length > 0 ? width(boundsOf(room.polygon)!) : 0),
    }),
    [room.polygon],
  );
  return (
    <>
      <Line
        {...selectable('rooms', room.id)}
        points={points}
        closed
        fill={selected ? canvasColors.selectedFill : canvasColors.room}
        stroke={selected ? canvasColors.selected : canvasColors.roomStroke}
        strokeWidth={1}
        strokeScaleEnabled={false}
        perfectDrawEnabled={false}
      />
      <Label text={room.name} at={label.at} maxWidth={label.width} scale={labelScale} />
    </>
  );
});

const ZoneShape = memo(function ZoneShape({ zone, selected }: { zone: Zone; selected: boolean }) {
  const points = useMemo(() => flat(zone.polygon), [zone.polygon]);
  return (
    <Line
      {...selectable('zones', zone.id)}
      points={points}
      closed
      fill={canvasColors.zone}
      stroke={selected ? canvasColors.selected : canvasColors.zoneStroke}
      strokeWidth={selected ? 2 : 1}
      dash={[6, 4]}
      strokeScaleEnabled={false}
      perfectDrawEnabled={false}
    />
  );
});

/**
 * A label of constant screen size centred on `at`. It is laid out in pixels and scaled down to
 * world units, because Konva measures text badly at sub-pixel font sizes.
 */
function Label({
  text,
  at,
  maxWidth,
  scale,
}: {
  text: string;
  at: Pt;
  maxWidth: number;
  scale: number;
}) {
  const widthPx = maxWidth * scale;
  if (!text || widthPx < MIN_LABEL_WIDTH_PX) return null;
  return (
    <Text
      text={text}
      x={at.x}
      y={at.y}
      scaleX={1 / scale}
      scaleY={1 / scale}
      width={widthPx}
      offsetX={widthPx / 2}
      offsetY={LABEL_PX / 2}
      fontSize={LABEL_PX}
      fontFamily={canvasFont}
      fill={canvasColors.label}
      align="center"
      wrap="none"
      ellipsis
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}
