import { useModelStore } from '@/model/store';
import type { CanvasContext } from '../canvas/extension';
import { OpeningShape } from './opening-shape';
import { useOpeningsStore } from './openings-store';

/** Where the active opening tool would place an opening, and an opening being dragged. */
export function OpeningsOverlay({ ctx }: { ctx: CanvasContext }) {
  const walls = useModelStore((s) => s.model?.floors[ctx.floorId]?.data.walls);
  const preview = useOpeningsStore((s) =>
    s.preview?.floorId === ctx.floorId ? s.preview.opening : null,
  );
  const dragged = useOpeningsStore((s) =>
    s.drag?.floorId === ctx.floorId ? s.drag.opening : null,
  );
  if (!walls) return null;
  const previewWall = preview && walls[preview.wallId];
  const draggedWall = dragged && walls[dragged.wallId];
  return (
    <>
      {previewWall && (
        <OpeningShape wall={previewWall} opening={preview} look="preview" listening={false} />
      )}
      {draggedWall && (
        <OpeningShape wall={draggedWall} opening={dragged} look="selected" listening={false} />
      )}
    </>
  );
}
