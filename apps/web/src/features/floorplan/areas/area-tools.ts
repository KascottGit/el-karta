import {
  distance,
  EPSILON,
  faceAt,
  wallFaces,
  type FloorData,
  type Id,
  type Pt,
  type Snap,
  type Wall,
  type WallFace,
} from '@el-karta/core';
import type { LucideIcon } from 'lucide-react';
import { PaintBucket, Pentagon, SquareDashed } from 'lucide-react';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import type { CanvasContext, CanvasPointer, MessageKey, Tool } from '../canvas/extension';
import { snapPointer, snapTolerance } from '../snapping/snapping';
import { addArea, checkPolygon, polygonMessage, type AreaCollection } from './area-edits';
import { areasUiStore, clearNotice, resetAreasPreview, showNotice } from './areas-ui-store';

interface Corner {
  owner: Id;
  p: Pt;
}

const cornersCache = new WeakMap<FloorData, readonly Corner[]>();

function areaCorners(data: FloorData): readonly Corner[] {
  let corners = cornersCache.get(data);
  if (!corners) {
    corners = [...Object.values(data.rooms), ...Object.values(data.zones)].flatMap((area) =>
      area.polygon.map((p) => ({ owner: area.id, p })),
    );
    cornersCache.set(data, corners);
  }
  return corners;
}

/**
 * Snaps a room or zone corner with the shared `snapPointer`: to walls, the grid and angle steps
 * from `from`, plus the corners of other rooms and zones and the extra `points` (such as those
 * drawn so far). Corners of the polygon `ignore` (the one being reshaped) are left out.
 */
export function snapForArea(
  p: CanvasPointer,
  ctx: CanvasContext,
  options: { ignore?: Id; points?: readonly Pt[]; from?: readonly Pt[] } = {},
): Snap {
  const data = modelStore.getState().model?.floors[ctx.floorId]?.data;
  const corners = data
    ? areaCorners(data).flatMap((c) => (c.owner === options.ignore ? [] : [c.p]))
    : [];
  return snapPointer(p, ctx, {
    points: [...corners, ...(options.points ?? [])],
    from: options.from ?? [],
  });
}

/** Validates and adds the polygon to the floor, or shows what is wrong with it. True when it was added. */
function commit(floorId: Id, collection: AreaCollection, polygon: readonly Pt[]) {
  const check = checkPolygon(polygon);
  if (!check.ok) {
    showNotice(polygonMessage(collection, check.problem));
    return false;
  }
  addArea(floorId, collection, check.polygon);
  return true;
}

/**
 * Draws a room or zone corner by corner. A tap on the first corner, a double tap or Enter closes it;
 * Backspace takes back the last corner. Escape, a tool switch or a floor switch also closes it if
 * it makes a valid polygon, and otherwise drops it with a notice saying why.
 */
export function polygonTool(spec: {
  id: string;
  collection: AreaCollection;
  label: MessageKey;
  icon: LucideIcon;
  order: number;
  shortcut: string;
}): Tool {
  const points = () => editorStore.getState().drawing?.points ?? [];

  /** Snaps against the polygon so far, with angle steps from its last and first corners. */
  const snapDraft = (p: CanvasPointer, ctx: CanvasContext) => {
    const placed = points();
    const first = placed[0];
    const last = placed.at(-1);
    const from = first && last ? (placed.length >= 2 ? [last, first] : [last]) : [];
    const snap = snapForArea(p, ctx, { points: placed, from });
    areasUiStore.setState({ snap });
    return snap.point;
  };

  /** Ends the drawing, adding the polygon if it is valid; `keepInvalid` keeps an invalid one to fix. */
  const finish = (keepInvalid: boolean) => {
    const placed = points();
    const floorId = areasUiStore.getState().drawingFloorId;
    if (placed.length === 0 || !floorId) return;
    const added = commit(floorId, spec.collection, placed);
    if (!added && keepInvalid) return;
    editorStore.getState().setDrawing(null);
    resetAreasPreview();
  };

  return {
    id: spec.id,
    label: spec.label,
    icon: spec.icon,
    order: spec.order,
    shortcut: spec.shortcut,
    cursor: 'crosshair',
    onHover: (p, ctx) => {
      const point = snapDraft(p, ctx);
      const { drawing, setDrawing } = editorStore.getState();
      if (drawing) setDrawing({ points: drawing.points, hover: point });
    },
    onTap: (p, ctx) => {
      clearNotice();
      const placed = points();
      const first = placed[0];
      if (placed.length >= 3 && first && distance(p.world, first) <= snapTolerance(p, ctx)) {
        finish(true);
        return;
      }
      const point = snapDraft(p, ctx);
      const last = placed.at(-1);
      if (last && distance(last, point) < EPSILON) return;
      if (placed.length === 0) areasUiStore.setState({ drawingFloorId: ctx.floorId });
      editorStore.getState().setDrawing({ points: [...placed, point], hover: point });
    },
    // The first tap of the pair has already placed the corner.
    onDoubleTap: () => {
      finish(true);
    },
    onKeyDown: (e) => {
      const { drawing, setDrawing } = editorStore.getState();
      if (!drawing) return false;
      if (e.key === 'Enter') {
        finish(true);
        return true;
      }
      if (e.key === 'Backspace') {
        const remaining = drawing.points.slice(0, -1);
        setDrawing(remaining.length > 0 ? { points: remaining, hover: drawing.hover } : null);
        clearNotice();
        return true;
      }
      return false;
    },
    onLeave: () => {
      areasUiStore.setState({ snap: null });
      const { drawing, setDrawing } = editorStore.getState();
      if (drawing?.hover) setDrawing({ points: drawing.points, hover: null });
    },
    onDeactivate: () => {
      finish(false);
      resetAreasPreview();
    },
  };
}

const facesCache = new WeakMap<Readonly<Record<Id, Wall>>, WallFace[]>();

/** The faces of the walls, rebuilt only when the walls change, so hovering stays cheap. */
function facesOf(walls: Readonly<Record<Id, Wall>>): WallFace[] {
  let faces = facesCache.get(walls);
  if (!faces) {
    faces = wallFaces(walls);
    facesCache.set(walls, faces);
  }
  return faces;
}

const faceUnder = (p: CanvasPointer, ctx: CanvasContext) => {
  const walls = modelStore.getState().model?.floors[ctx.floorId]?.data.walls;
  return walls ? faceAt(facesOf(walls), p.world) : null;
};

/** Tap inside walls that close around a space to make it a room. */
export const fillRoomTool: Tool = {
  id: 'fill-room',
  label: 'areas.tools.fillRoom',
  icon: PaintBucket,
  order: 21,
  shortcut: 'y',
  cursor: 'crosshair',
  onHover: (p, ctx) => {
    areasUiStore.setState({ fill: faceUnder(p, ctx)?.polygon ?? null });
  },
  onTap: (p, ctx) => {
    clearNotice();
    const face = faceUnder(p, ctx);
    if (!face) showNotice('areas.notEnclosed');
    else commit(ctx.floorId, 'rooms', face.polygon);
  },
  onLeave: () => {
    areasUiStore.setState({ fill: null });
  },
  onDeactivate: resetAreasPreview,
};

export const roomTool = polygonTool({
  id: 'room',
  collection: 'rooms',
  label: 'areas.tools.room',
  icon: Pentagon,
  order: 20,
  shortcut: 'r',
});

export const zoneTool = polygonTool({
  id: 'zone',
  collection: 'zones',
  label: 'areas.tools.zone',
  icon: SquareDashed,
  order: 22,
  shortcut: 'z',
});

export const AREA_DRAWING_TOOLS: ReadonlySet<string> = new Set([roomTool.id, zoneTool.id]);
