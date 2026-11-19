import type { Id, Pt, Wall } from '@el-karta/core';
import { memo, useMemo } from 'react';
import { Line, RegularPolygon } from 'react-konva';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '../editor-store';
import { createCuller } from '../canvas/culling';
import type { CanvasContext } from '../canvas/extension';
import { selectable } from '../canvas/hit';
import { selectedIds } from '../canvas/selection';
import { canvasColors } from '../canvas/theme';
import { useRenderWindow } from '../canvas/use-render-window';
import { wallColors } from './colors';
import { wallIssues, type WallIssue } from './wall-issues';
import { endKey, jointEnds, wallBounds, wallOutline } from './wall-outline';
import { useWallsStore } from './walls-store';

const cullWalls = createCuller(wallBounds);
const NO_JOINTS: ReadonlySet<string> = new Set();
const NO_ISSUES: ReadonlyMap<Id, readonly WallIssue[]> = new Map();
const NOT_MOVING: ReadonlySet<Id> = new Set();
const MARKER_PX = 9;

/** Walls, each drawn as a polygon of its thickness, with a marker on walls the validator flags. */
export function WallsLayer({ ctx }: { ctx: CanvasContext }) {
  const floor = useModelStore((s) => s.model?.floors[ctx.floorId]);
  const walls = floor?.data.walls;
  const { rect: view, scale } = useRenderWindow();
  const selection = useEditorStore((s) => s.selection);
  // Walls whose corner is being dragged are drawn by the overlay meanwhile.
  const moving = useWallsStore((s) =>
    s.drag?.floorId === ctx.floorId ? s.drag.moving : NOT_MOVING,
  );
  const joints = useMemo(() => (walls ? jointEnds(walls) : NO_JOINTS), [walls]);
  const issues = useMemo(() => (floor ? wallIssues(floor) : NO_ISSUES), [floor]);
  const visible = useMemo(
    () => (walls ? cullWalls(walls, view).filter((w) => !moving.has(w.id)) : []),
    [walls, view, moving],
  );
  const selected = useMemo(() => selectedIds(selection, 'walls'), [selection]);

  return (
    <>
      {visible.map((wall) => (
        <WallShape
          key={wall.id}
          wall={wall}
          capA={joints.has(endKey(wall.id, 'a'))}
          capB={joints.has(endKey(wall.id, 'b'))}
          color={selected.has(wall.id) ? canvasColors.selected : wallColors.wall}
        />
      ))}
      {visible.map((wall) => {
        const flagged = issues.get(wall.id);
        return flagged ? (
          <IssueMarker
            key={`issue:${wall.id}`}
            wallId={wall.id}
            at={flagged.some((i) => i.code === 'wall.zero-length') ? wall.a : wall.b}
            error={flagged.some((i) => i.severity === 'error')}
            scale={scale}
          />
        ) : null;
      })}
    </>
  );
}

export const WallShape = memo(function WallShape({
  wall,
  capA,
  capB,
  color,
  listening = true,
}: {
  wall: Wall;
  capA: boolean;
  capB: boolean;
  color: string;
  listening?: boolean;
}) {
  const points = useMemo(() => wallOutline(wall, capA, capB), [wall, capA, capB]);
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
      listening={listening}
      perfectDrawEnabled={false}
    />
  );
});

/** A warning triangle at the wall end beyond which openings or devices lie; tapping it selects the wall. */
const IssueMarker = memo(function IssueMarker({
  wallId,
  at,
  error,
  scale,
}: {
  wallId: Id;
  at: Pt;
  error: boolean;
  scale: number;
}) {
  return (
    <RegularPolygon
      {...selectable('walls', wallId)}
      x={at.x}
      y={at.y}
      sides={3}
      radius={MARKER_PX / scale}
      fill={error ? wallColors.error : wallColors.warning}
      stroke={wallColors.handle}
      strokeWidth={1.5}
      strokeScaleEnabled={false}
      perfectDrawEnabled={false}
    />
  );
});
