import type { Wall } from '@el-karta/core';
import { useModelStore } from '@/model/store';
import type { CanvasContext } from '../canvas/extension';
import { useWallsStore } from '../walls/walls-store';
import { OpeningShape } from './opening-shape';
import { useOpeningsStore } from './openings-store';

const NO_WALLS: readonly Wall[] = [];

/**
 * Where the active opening tool would place an opening, an opening being dragged, and the openings
 * of walls whose corner is being dragged, on those walls as they would be after the drop.
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
    </>
  );
}
