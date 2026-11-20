import type { Id, Opening, Pt, Wall } from '@el-karta/core';
import { memo, useMemo } from 'react';
import { RegularPolygon } from 'react-konva';
import { useModelStore } from '@/model/store';
import { useEditorStore } from '../editor-store';
import { createCuller } from '../canvas/culling';
import type { CanvasContext } from '../canvas/extension';
import { selectable } from '../canvas/hit';
import { selectedIds } from '../canvas/selection';
import { issueColors } from '../canvas/theme';
import { useRenderWindow } from '../canvas/use-render-window';
import { wallColors } from '../walls/colors';
import { wallBounds } from '../walls/wall-outline';
import { useWallsStore } from '../walls/walls-store';
import { openingIssues, type OpeningIssue } from './opening-issues';
import { OpeningShape } from './opening-shape';
import { useOpeningsStore } from './openings-store';
import { openingSymbol } from './symbol';

// Openings are culled by their wall, whose bounds stay right when the wall moves.
const cullWalls = createCuller(wallBounds);
const NO_ISSUES: ReadonlyMap<Id, readonly OpeningIssue[]> = new Map();
const NO_OPENINGS: ReadonlyMap<Id, readonly Opening[]> = new Map();
const NOT_MOVING: ReadonlySet<Id> = new Set();
const MARKER_PX = 8;

function byWall(openings: Readonly<Record<Id, Opening>>): ReadonlyMap<Id, readonly Opening[]> {
  const map = new Map<Id, Opening[]>();
  for (const opening of Object.values(openings)) {
    const list = map.get(opening.wallId);
    if (list) list.push(opening);
    else map.set(opening.wallId, [opening]);
  }
  return map;
}

/** Doors, windows and passages in their walls, with a marker on those the validator flags. */
export function OpeningsLayer({ ctx }: { ctx: CanvasContext }) {
  const floor = useModelStore((s) => s.model?.floors[ctx.floorId]);
  const walls = floor?.data.walls;
  const openings = floor?.data.openings;
  const { rect: view, scale } = useRenderWindow();
  const selection = useEditorStore((s) => s.selection);
  // The opening being dragged is drawn by the overlay meanwhile.
  const dragged = useOpeningsStore((s) => (s.drag?.floorId === ctx.floorId ? s.drag.id : null));
  // Openings on walls whose corner is being dragged are drawn by the overlay meanwhile.
  const moving = useWallsStore((s) =>
    s.drag?.floorId === ctx.floorId ? s.drag.moving : NOT_MOVING,
  );
  const grouped = useMemo(() => (openings ? byWall(openings) : NO_OPENINGS), [openings]);
  const issues = useMemo(() => (floor ? openingIssues(floor) : NO_ISSUES), [floor]);
  const visible = useMemo(
    () =>
      walls && grouped.size > 0
        ? cullWalls(walls, view).flatMap((wall) =>
            moving.has(wall.id)
              ? []
              : (grouped.get(wall.id) ?? []).map((opening) => ({ wall, opening })),
          )
        : [],
    [walls, grouped, view, moving],
  );
  const selected = useMemo(() => selectedIds(selection, 'openings'), [selection]);

  return (
    <>
      {visible.map(({ wall, opening }) =>
        opening.id === dragged ? null : (
          <OpeningShape
            key={opening.id}
            wall={wall}
            opening={opening}
            look={selected.has(opening.id) ? 'selected' : 'plain'}
          />
        ),
      )}
      {visible.map(({ wall, opening }) => {
        const flagged = issues.get(opening.id);
        return flagged && opening.id !== dragged ? (
          <IssueMarker
            key={`issue:${opening.id}`}
            wall={wall}
            opening={opening}
            error={flagged.some((i) => i.severity === 'error')}
            scale={scale}
          />
        ) : null;
      })}
    </>
  );
}

/** A warning triangle on the middle of a flagged opening; tapping it selects the opening. */
const IssueMarker = memo(function IssueMarker({
  wall,
  opening,
  error,
  scale,
}: {
  wall: Wall;
  opening: Opening;
  error: boolean;
  scale: number;
}) {
  const at = useMemo<Pt | undefined>(() => openingSymbol(wall, opening)?.centre, [wall, opening]);
  if (!at) return null;
  return (
    <RegularPolygon
      {...selectable('openings', opening.id)}
      x={at.x}
      y={at.y}
      sides={3}
      radius={MARKER_PX / scale}
      fill={issueColors[error ? 'error' : 'warning']}
      stroke={wallColors.handle}
      strokeWidth={1.5}
      strokeScaleEnabled={false}
      perfectDrawEnabled={false}
    />
  );
});
