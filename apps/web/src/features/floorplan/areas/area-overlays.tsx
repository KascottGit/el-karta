import type { Id, Pt } from '@el-karta/core';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Circle, Line } from 'react-konva';
import { useModelStore } from '@/model/store';
import { useEditorStore, type Drawing } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { handle } from '../canvas/hit';
import { ScreenLabel } from '../canvas/screen-label';
import { AREA_COLLECTIONS, type AreaCollection } from './area-edits';
import { midpointHandle, vertexHandle } from './area-handles';
import { AREA_DRAWING_TOOLS, fillRoomTool } from './area-tools';
import { useAreasUi } from './areas-ui-store';
import { flat } from './bounds';
import { areaColors, issueColors } from './colors';

const VERTEX_PX = 6;
const MIDPOINT_PX = 4;
const SNAP_PX = 5;
const NOTICE_WIDTH_PX = 480;
const NOTICE_OFFSET_PX = 18;

/** The polygon being drawn, the room the fill tool would make, the snap marker and notices. */
export function AreaDrafts() {
  const { t } = useTranslation();
  const tool = useEditorStore((s) => s.tool);
  const drawing = useEditorStore((s) => s.drawing);
  const scale = useEditorStore((s) => s.viewport.scale);
  const snap = useAreasUi((s) => s.snap);
  const fill = useAreasUi((s) => s.fill);
  const notice = useAreasUi((s) => s.notice);
  return (
    <>
      {fill && tool === fillRoomTool.id && (
        <Line
          points={flat(fill)}
          closed
          fill={areaColors.draftFill}
          stroke={areaColors.draft}
          strokeWidth={2}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      {drawing && AREA_DRAWING_TOOLS.has(tool) && <DraftPolygon drawing={drawing} scale={scale} />}
      {snap && (
        <Circle
          x={snap.x}
          y={snap.y}
          radius={SNAP_PX / scale}
          stroke={areaColors.draft}
          strokeWidth={2}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      {notice && (
        <ScreenLabel
          text={t(notice.message, { count: 1 })}
          at={{ x: notice.at.x, y: notice.at.y - NOTICE_OFFSET_PX / scale }}
          maxWidth={NOTICE_WIDTH_PX / scale}
          scale={scale}
          fill={issueColors.error}
        />
      )}
    </>
  );
}

function DraftPolygon({ drawing, scale }: { drawing: Drawing; scale: number }) {
  const { points, hover } = drawing;
  const first = points[0];
  const path = hover ? [...points, hover] : points;
  return (
    <>
      {points.length >= 2 && (
        <Line
          points={flat(points)}
          closed
          fill={areaColors.draftFill}
          strokeEnabled={false}
          listening={false}
        />
      )}
      <Line
        points={flat(path)}
        stroke={areaColors.draft}
        strokeWidth={2}
        strokeScaleEnabled={false}
        listening={false}
      />
      {hover && first && points.length >= 2 && (
        <Line
          points={flat([hover, first])}
          stroke={areaColors.draft}
          strokeWidth={1}
          dash={[4, 4]}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      {points.map((p, i) => (
        <Circle
          key={i}
          x={p.x}
          y={p.y}
          // The first corner is larger once tapping it would close the polygon.
          radius={(i === 0 && points.length >= 3 ? VERTEX_PX : MIDPOINT_PX) / scale}
          fill={areaColors.handle}
          stroke={areaColors.draft}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          listening={false}
        />
      ))}
    </>
  );
}

/** Vertex and midpoint handles on the selected rooms and zones, hidden while drawing. */
export function AreaHandles({ ctx }: { ctx: CanvasContext }) {
  const data = useModelStore((s) => s.model?.floors[ctx.floorId]?.data);
  const selection = useEditorStore((s) => s.selection);
  const drawing = useEditorStore((s) => s.drawing);
  const scale = useEditorStore((s) => s.viewport.scale);
  const dragging = useAreasUi((s) => s.drag?.id);
  if (!data || drawing) return null;
  return selection.map(({ collection, id }) => {
    const areaCollection = AREA_COLLECTIONS.find((c) => c === collection);
    const area = areaCollection && data[areaCollection][id];
    if (!areaCollection || !area || id === dragging) return null;
    return (
      <PolygonHandles
        key={id}
        collection={areaCollection}
        id={id}
        polygon={area.polygon}
        scale={scale}
      />
    );
  });
}

const PolygonHandles = memo(function PolygonHandles({
  collection,
  id,
  polygon,
  scale,
}: {
  collection: AreaCollection;
  id: Id;
  polygon: readonly Pt[];
  scale: number;
}) {
  return (
    <>
      {polygon.map((p, index) => {
        const next = polygon[(index + 1) % polygon.length]!;
        return (
          <Circle
            key={`m${index}`}
            {...handle(midpointHandle, { collection, id, index })}
            x={(p.x + next.x) / 2}
            y={(p.y + next.y) / 2}
            radius={MIDPOINT_PX / scale}
            fill={areaColors.midpoint}
            stroke={areaColors.handle}
            strokeWidth={1}
            strokeScaleEnabled={false}
          />
        );
      })}
      {polygon.map((p, index) => (
        <Circle
          key={`v${index}`}
          {...handle(vertexHandle, { collection, id, index })}
          x={p.x}
          y={p.y}
          radius={VERTEX_PX / scale}
          fill={areaColors.handle}
          stroke={areaColors.draft}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
        />
      ))}
    </>
  );
});
