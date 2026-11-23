import {
  add,
  EPSILON,
  leftNormal,
  normalize,
  scale as scaled,
  sub,
  wallLength,
  type Opening,
  type Wall,
} from '@el-karta/core';
import { Line } from 'react-konva';
import { useModelStore } from '@/model/store';
import { DEFAULT_TOOL, useEditorStore, type EditorState } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { handle } from '../canvas/hit';
import { canvasColors } from '../canvas/theme';
import { useWallsStore } from '../walls/walls-store';
import { openingEdgeHandle } from './opening-handle';
import { OpeningShape } from './opening-shape';
import { useOpeningsStore } from './openings-store';
import type { OpeningEdge } from './resize';

const NO_WALLS: readonly Wall[] = [];
/** How far an edge handle reaches past each face of the wall. */
const ARM_PX = 7;
const EDGE_PX = 4;
const EDGES: readonly OpeningEdge[] = ['start', 'end'];

/**
 * Where the active opening tool would place an opening, an opening being dragged, and the openings
 * of walls whose corner is being dragged, on those walls as they would be after the drop; and the
 * edge handles of a selected opening.
 */
export function OpeningsOverlay({ ctx }: { ctx: CanvasContext }) {
  const data = useModelStore((s) => s.model?.floors[ctx.floorId]?.data);
  const preview = useOpeningsStore((s) =>
    s.preview?.floorId === ctx.floorId ? s.preview.opening : null,
  );
  const dragged = useOpeningsStore((s) =>
    s.drag?.floorId === ctx.floorId ? s.drag.opening : null,
  );
  const movedWalls = useWallsStore((s) =>
    s.drag?.floorId === ctx.floorId ? s.drag.preview : NO_WALLS,
  );
  if (!data) return null;
  const previewWall = preview && data.walls[preview.wallId];
  const draggedWall = dragged && data.walls[dragged.wallId];
  const moved = new Map(movedWalls.map((w) => [w.id, w]));
  const onMovedWalls =
    moved.size > 0
      ? Object.values(data.openings).flatMap((opening) => {
          const wall = moved.get(opening.wallId);
          return wall ? [{ wall, opening }] : [];
        })
      : [];
  return (
    <>
      {onMovedWalls.map(({ wall, opening }) => (
        <OpeningShape
          key={opening.id}
          wall={wall}
          opening={opening}
          look="plain"
          listening={false}
        />
      ))}
      {previewWall && (
        <OpeningShape wall={previewWall} opening={preview} look="preview" listening={false} />
      )}
      {draggedWall && (
        <OpeningShape wall={draggedWall} opening={dragged} look="selected" listening={false} />
      )}
      <EdgeHandles ctx={ctx} />
    </>
  );
}

/** The id of the only selected item if it is an opening and the select tool is idle. */
const resizableId = (s: EditorState) => {
  const only = s.selection.length === 1 ? s.selection[0] : undefined;
  return only?.collection === 'openings' && s.tool === DEFAULT_TOOL && s.drawing === null
    ? only.id
    : null;
};

/** A bar across the wall at each edge of the only selected opening, dragged to change its width. */
function EdgeHandles({ ctx }: { ctx: CanvasContext }) {
  const id = useEditorStore(resizableId);
  const scale = useEditorStore((s) => s.viewport.scale);
  const opening = useModelStore((s) =>
    id ? s.model?.floors[ctx.floorId]?.data.openings[id] : undefined,
  );
  const wall = useModelStore((s) =>
    opening ? s.model?.floors[ctx.floorId]?.data.walls[opening.wallId] : undefined,
  );
  const dragging = useOpeningsStore((s) => s.drag !== null);
  const wallDragging = useWallsStore((s) => s.drag !== null);
  if (!opening || !wall || dragging || wallDragging || wallLength(wall) < EPSILON) return null;
  return EDGES.map((edge) => (
    <Line
      key={edge}
      {...handle(openingEdgeHandle, { id: opening.id, edge })}
      points={edgeBar(wall, opening, edge, wall.thickness / 2 + ARM_PX / scale)}
      stroke={canvasColors.selected}
      strokeWidth={EDGE_PX}
      lineCap="round"
      strokeScaleEnabled={false}
      hitStrokeWidth={EDGE_PX * 3}
    />
  ));
}

function edgeBar(wall: Wall, opening: Opening, edge: OpeningEdge, half: number): number[] {
  const dir = normalize(sub(wall.b, wall.a));
  const at = add(
    wall.a,
    scaled(dir, edge === 'start' ? opening.offset : opening.offset + opening.width),
  );
  const n = scaled(leftNormal(dir), half);
  const from = sub(at, n);
  const to = add(at, n);
  return [from.x, from.y, to.x, to.y];
}
