import type { Wall } from '@el-karta/core';
import { memo, useMemo } from 'react';
import { Line } from 'react-konva';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '../../editor-store';
import { createCuller } from '../culling';
import type { CanvasContext } from '../extension';
import { selectable } from '../hit';
import { selectedIds } from '../selection';
import { canvasColors } from '../theme';
import { endKey, jointEnds, wallBounds, wallOutline } from '../wall-outline';

const cullWalls = createCuller(wallBounds);
const NO_JOINTS: ReadonlySet<string> = new Set();

/** Read-only walls, each drawn as a polygon of its thickness. */
export function WallsLayer({ ctx }: { ctx: CanvasContext }) {
  const walls = useModelStore((s) => s.model?.floors[ctx.floorId]?.data.walls);
  const view = useEditorStore((s) => s.renderWindow.rect);
  const selection = useEditorStore((s) => s.selection);
  const joints = useMemo(() => (walls ? jointEnds(walls) : NO_JOINTS), [walls]);
  const visible = useMemo(() => (walls ? cullWalls(walls, view) : []), [walls, view]);
  const selected = useMemo(() => selectedIds(selection, 'walls'), [selection]);

  return visible.map((wall) => (
    <WallShape
      key={wall.id}
      wall={wall}
      capA={joints.has(endKey(wall.id, 'a'))}
      capB={joints.has(endKey(wall.id, 'b'))}
      selected={selected.has(wall.id)}
    />
  ));
}

const WallShape = memo(function WallShape({
  wall,
  capA,
  capB,
  selected,
}: {
  wall: Wall;
  capA: boolean;
  capB: boolean;
  selected: boolean;
}) {
  const points = useMemo(() => wallOutline(wall, capA, capB), [wall, capA, capB]);
  const color = selected ? canvasColors.selected : canvasColors.wall;
  return (
    <Line
      {...selectable('walls', wall.id)}
      points={points}
      closed
      fill={color}
      // A one-pixel outline keeps thin walls visible when zoomed far out.
      stroke={color}
      strokeWidth={1}
      strokeScaleEnabled={false}
      hitStrokeWidth={8}
      perfectDrawEnabled={false}
    />
  );
});
