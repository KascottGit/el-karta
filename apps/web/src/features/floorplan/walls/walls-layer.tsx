import { worstSeverity } from '../validation/severity';
import type { Id, Wall } from '@el-karta/core';
import { memo, useMemo } from 'react';
import { Line } from 'react-konva';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '../editor-store';
import { createCuller } from '../canvas/culling';
import type { CanvasContext } from '../canvas/extension';
import { handle, nodeProps, selectable } from '../canvas/hit';
import { selectedIds } from '../canvas/selection';
import { canvasColors } from '../canvas/theme';
import { useRenderWindow } from '../canvas/use-render-window';
import { IssueMarker } from '../validation/issue-marker';
import { wallColors } from './colors';
import { wallIssues, type WallIssue } from './wall-issues';
import { wallMoveHandle } from './move-wall-handle';
import { wallsMovable } from './move-wall-tool';
import { endKey, jointEnds, wallBounds, wallOutline } from './wall-outline';
import { useWallsStore } from './walls-store';

const cullWalls = createCuller(wallBounds);
const NO_JOINTS: ReadonlySet<string> = new Set();
const NO_ISSUES: ReadonlyMap<Id, readonly WallIssue[]> = new Map();
const NOT_MOVING: ReadonlySet<Id> = new Set();
const NO_WALLS: readonly Wall[] = [];
const MARKER_PX = 9;

/** Walls, each drawn as a polygon of its thickness, with a marker on walls the validator flags. */
export function WallsLayer({ ctx }: { ctx: CanvasContext }) {
  const floor = useModelStore((s) => s.model?.floors[ctx.floorId]);
  const walls = floor?.data.walls;
  const { rect: view } = useRenderWindow();
  const selection = useEditorStore((s) => s.selection);
  const movable = useEditorStore(wallsMovable);
  // Walls being dragged are drawn by the overlay meanwhile.
  const moving = useWallsStore((s) =>
    s.drag?.floorId === ctx.floorId ? s.drag.moving : NOT_MOVING,
  );
  const joints = useMemo(() => (walls ? jointEnds(walls) : NO_JOINTS), [walls]);
  const issues = useMemo(() => (floor ? wallIssues(floor) : NO_ISSUES), [floor]);
  const culled = useMemo(() => (walls ? cullWalls(walls, view) : NO_WALLS), [walls, view]);
  const visible = useMemo(
    () => (moving.size > 0 ? culled.filter((w) => !moving.has(w.id)) : culled),
    [culled, moving],
  );
  const selected = useMemo(() => selectedIds(selection, 'walls'), [selection]);

  // Memoized like `AreasLayer`'s, for the urgent render after a render window change.
  return useMemo(
    () => (
      <>
        {visible.map((wall) => (
          <WallShape
            key={wall.id}
            wall={wall}
            capA={joints.has(endKey(wall.id, 'a'))}
            capB={joints.has(endKey(wall.id, 'b'))}
            color={selected.has(wall.id) ? canvasColors.selected : wallColors.wall}
            movable={movable && selected.has(wall.id)}
          />
        ))}
        {visible.map((wall) => {
          const flagged = issues.get(wall.id);
          return flagged ? (
            <IssueMarker
              key={`issue:${wall.id}`}
              collection="walls"
              id={wall.id}
              // At the end beyond which openings or devices lie.
              at={flagged.some((i) => i.code === 'wall.zero-length') ? wall.a : wall.b}
              severity={worstSeverity(flagged) ?? 'warning'}
              radiusPx={MARKER_PX}
            />
          ) : null;
        })}
      </>
    ),
    [visible, joints, selected, issues, movable],
  );
}

export const WallShape = memo(function WallShape({
  wall,
  capA,
  capB,
  color,
  listening = true,
  movable = false,
}: {
  wall: Wall;
  capA: boolean;
  capB: boolean;
  color: string;
  listening?: boolean;
  /** A drag on the wall moves it (a selected wall), rather than panning. */
  movable?: boolean;
}) {
  const points = useMemo(() => wallOutline(wall, capA, capB), [wall, capA, capB]);
  const select = selectable('walls', wall.id);
  return (
    <Line
      {...(movable ? nodeProps(select, handle(wallMoveHandle, { wallId: wall.id })) : select)}
      points={points}
      closed
      fill={color}
      // A one-pixel outline keeps thin walls visible when zoomed far out.
      stroke={color}
      strokeWidth={1}
      strokeScaleEnabled={false}
      hitStrokeWidth={8}
      listening={listening}
      perfectDrawEnabled={false}
    />
  );
});
