import { centroid, type IssueSeverity, type Pt, type Room, type Zone } from '@el-karta/core';
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
import { canvasColors, issueColors } from '../canvas/theme';
import { useRenderWindow } from '../canvas/use-render-window';
import { areaIssues, worstSeverity } from './area-issues';
import { useAreasUi } from './areas-ui-store';
import { areaBounds, flat } from './bounds';
import { areaColors } from './colors';

const cullAreas = createCuller(areaBounds);
const NO_ISSUES: ReturnType<typeof areaIssues> = new Map();
const ZONE_LABEL_OFFSET_PX = 16;

/** Rooms with name labels and translucent zones over them, outlined in the colour of their worst issue. */
export function AreasLayer({ ctx }: { ctx: CanvasContext }) {
  const floor = useModelStore((s) => s.model?.floors[ctx.floorId]);
  const rooms = floor?.data.rooms;
  const zones = floor?.data.zones;
  const { rect: view, scale } = useRenderWindow();
  const selection = useEditorStore((s) => s.selection);
  const drag = useAreasUi((s) => s.drag);
  const issues = useMemo(() => (floor ? areaIssues(floor) : NO_ISSUES), [floor]);
  const visibleRooms = useMemo(() => (rooms ? cullAreas(rooms, view) : []), [rooms, view]);
  const visibleZones = useMemo(() => (zones ? cullAreas(zones, view) : []), [zones, view]);
  const selectedRooms = useMemo(() => selectedIds(selection, 'rooms'), [selection]);
  const selectedZones = useMemo(() => selectedIds(selection, 'zones'), [selection]);
  const shape = (area: Room | Zone) => (drag?.id === area.id ? drag.polygon : area.polygon);

  return (
    <>
      {visibleRooms.map((room) => (
        <RoomShape
          key={room.id}
          room={room}
          polygon={shape(room)}
          selected={selectedRooms.has(room.id)}
          severity={worstSeverity(issues.get(room.id))}
          labelScale={scale}
        />
      ))}
      {visibleZones.map((zone) => (
        <ZoneShape
          key={zone.id}
          zone={zone}
          polygon={shape(zone)}
          selected={selectedZones.has(zone.id)}
          severity={worstSeverity(issues.get(zone.id))}
          labelScale={scale}
        />
      ))}
    </>
  );
}

function labelPlacement(polygon: readonly Pt[], dy = 0) {
  const bounds = boundsOf(polygon);
  const at = centroid(polygon);
  return { at: { x: at.x, y: at.y + dy }, width: bounds ? 0.9 * width(bounds) : 0 };
}

const RoomShape = memo(function RoomShape({
  room,
  polygon,
  selected,
  severity,
  labelScale,
}: {
  room: Room;
  polygon: readonly Pt[];
  selected: boolean;
  severity: IssueSeverity | null;
  labelScale: number;
}) {
  const points = useMemo(() => flat(polygon), [polygon]);
  const label = useMemo(() => labelPlacement(polygon), [polygon]);
  return (
    <>
      <Line
        {...selectable('rooms', room.id)}
        points={points}
        closed
        fill={selected ? areaColors.roomSelected : areaColors.room}
        stroke={
          severity
            ? issueColors[severity]
            : selected
              ? canvasColors.selected
              : areaColors.roomStroke
        }
        strokeWidth={severity ? 2 : 1}
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

const ZoneShape = memo(function ZoneShape({
  zone,
  polygon,
  selected,
  severity,
  labelScale,
}: {
  zone: Zone;
  polygon: readonly Pt[];
  selected: boolean;
  severity: IssueSeverity | null;
  labelScale: number;
}) {
  const points = useMemo(() => flat(polygon), [polygon]);
  const hitFunc = useMemo(() => outlineHit(points), [points]);
  // Below the centre, so it does not cover the name of a room with the same outline.
  const label = useMemo(
    () => labelPlacement(polygon, ZONE_LABEL_OFFSET_PX / labelScale),
    [polygon, labelScale],
  );
  return (
    <>
      <Line
        {...selectable('zones', zone.id)}
        points={points}
        closed
        fill={areaColors.zone}
        stroke={
          severity
            ? issueColors[severity]
            : selected
              ? canvasColors.selected
              : areaColors.zoneStroke
        }
        strokeWidth={selected || severity ? 2 : 1}
        dash={[6, 4]}
        strokeScaleEnabled={false}
        hitStrokeWidth={8}
        hitFunc={hitFunc}
        perfectDrawEnabled={false}
      />
      <ScreenLabel
        text={zone.name}
        at={label.at}
        maxWidth={label.width}
        scale={labelScale}
        fill={areaColors.zoneStroke}
      />
    </>
  );
});
