import type { Id, IssueSeverity, Room, Zone } from '@el-karta/core';
import type Konva from 'konva';
import { memo, useMemo } from 'react';
import { Line } from 'react-konva';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '../editor-store';
import { createCuller } from '../canvas/culling';
import type { CanvasContext } from '../canvas/extension';
import { selectable } from '../canvas/hit';
import { ScreenLabel } from '../canvas/screen-label';
import { selectedIds } from '../canvas/selection';
import { canvasColors, issueColors } from '../canvas/theme';
import { useRenderWindow } from '../canvas/use-render-window';
import { worstSeverity } from '../validation/severity';
import { areaIssues } from './area-issues';
import { useAreasUi } from './areas-ui-store';
import { areaBounds, flat, labelPlacement, ZONE_LABEL_OFFSET_PX } from './bounds';
import { areaColors } from './colors';

const cullAreas = createCuller(areaBounds);
const NO_ISSUES: ReturnType<typeof areaIssues> = new Map();

const without = <A extends Room | Zone>(areas: readonly A[], id: Id | undefined) =>
  id === undefined ? areas : areas.filter((a) => a.id !== id);

/** Rooms with name labels and translucent zones over them, outlined in the colour of their worst issue. */
export function AreasLayer({ ctx }: { ctx: CanvasContext }) {
  const floor = useModelStore((s) => s.model?.floors[ctx.floorId]);
  const rooms = floor?.data.rooms;
  const zones = floor?.data.zones;
  const { rect: view } = useRenderWindow();
  const selection = useEditorStore((s) => s.selection);
  const issues = useMemo(() => (floor ? areaIssues(floor) : NO_ISSUES), [floor]);
  // The area whose outline is being reshaped is drawn by the overlay meanwhile.
  const dragged = useAreasUi((s) => s.drag?.id);
  const visibleRooms = useMemo(
    () => (rooms ? without(cullAreas(rooms, view), dragged) : []),
    [rooms, view, dragged],
  );
  const visibleZones = useMemo(
    () => (zones ? without(cullAreas(zones, view), dragged) : []),
    [zones, view, dragged],
  );
  const selectedRooms = useMemo(() => selectedIds(selection, 'rooms'), [selection]);
  const selectedZones = useMemo(() => selectedIds(selection, 'zones'), [selection]);

  // Memoized, so that the urgent render after a render window change, which still sees the old
  // window, reuses the elements instead of creating them again (see `useRenderWindow`).
  return useMemo(
    () => (
      <>
        {visibleRooms.map((room) => (
          <RoomShape
            key={room.id}
            room={room}
            selected={selectedRooms.has(room.id)}
            severity={worstSeverity(issues.get(room.id))}
          />
        ))}
        {visibleZones.map((zone) => (
          <ZoneShape
            key={zone.id}
            zone={zone}
            selected={selectedZones.has(zone.id)}
            severity={worstSeverity(issues.get(zone.id))}
          />
        ))}
      </>
    ),
    [visibleRooms, visibleZones, selectedRooms, selectedZones, issues],
  );
}

const RoomShape = memo(function RoomShape({
  room,
  selected,
  severity,
}: {
  room: Room;
  selected: boolean;
  severity: IssueSeverity | null;
}) {
  const points = useMemo(() => flat(room.polygon), [room.polygon]);
  const label = useMemo(() => labelPlacement(room.polygon), [room.polygon]);
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
      <ScreenLabel text={room.name} at={label.at} maxWidth={label.width} />
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
  selected,
  severity,
}: {
  zone: Zone;
  selected: boolean;
  severity: IssueSeverity | null;
}) {
  const points = useMemo(() => flat(zone.polygon), [zone.polygon]);
  const hitFunc = useMemo(() => outlineHit(points), [points]);
  const label = useMemo(() => labelPlacement(zone.polygon), [zone.polygon]);
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
        // Below the centre, so it does not cover the name of a room with the same outline.
        offsetYPx={ZONE_LABEL_OFFSET_PX}
        fill={areaColors.zoneStroke}
      />
    </>
  );
});
