import {
  distance,
  EPSILON,
  faceAt,
  wallFaces,
  type Id,
  type Pt,
  type Wall,
  type WallFace,
} from '@el-karta/core';
import type { LucideIcon } from 'lucide-react';
import { PaintBucket, Pentagon, SquareDashed } from 'lucide-react';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import type { CanvasContext, CanvasPointer, MessageKey, Tool } from '../canvas/extension';
import { addArea, checkPolygon, polygonMessage, type AreaCollection } from './area-edits';
import { areaSnapTargets, snapAreaPoint, type AreaSnap } from './area-snap';
import { areasUiStore, resetAreasUi, showNotice } from './areas-ui-store';

const SNAP_PX = { mouse: 8, pen: 8, touch: 16 } as const;

export const snapTolerance = (p: CanvasPointer, ctx: CanvasContext) =>
  ctx.pxToWorld(SNAP_PX[p.kind]);

/** Snaps a pointer for a room or zone corner; Alt turns snapping off. */
export function snapForArea(
  p: CanvasPointer,
  ctx: CanvasContext,
  options: { ignore?: Id; extra?: readonly Pt[] } = {},
): AreaSnap {
  const data = modelStore.getState().model?.floors[ctx.floorId]?.data;
  if (!data || p.altKey) return { point: p.world, snapped: false };
  return snapAreaPoint(p.world, areaSnapTargets(data), snapTolerance(p, ctx), options);
}

const showSnap = (snap: AreaSnap) => {
  areasUiStore.setState({ snap: snap.snapped ? snap.point : null });
};

/** Validates and adds the polygon, or shows what is wrong with it. True when it was added. */
function commit(ctx: CanvasContext, collection: AreaCollection, polygon: readonly Pt[], at: Pt) {
  const check = checkPolygon(polygon);
  if (!check.ok) {
    showNotice(at, polygonMessage(collection, check.problem));
    return false;
  }
  addArea(ctx.floorId, collection, check.polygon);
  return true;
}

/**
 * Draws a room or zone corner by corner. A tap on the first corner, a double tap or Enter closes it;
 * Backspace takes back the last corner.
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
  const finish = (ctx: CanvasContext) => {
    const placed = points();
    const last = placed.at(-1);
    if (last && commit(ctx, spec.collection, placed, last)) {
      editorStore.getState().setDrawing(null);
      areasUiStore.setState({ snap: null });
    }
  };
  return {
    id: spec.id,
    label: spec.label,
    icon: spec.icon,
    order: spec.order,
    shortcut: spec.shortcut,
    cursor: 'crosshair',
    onHover: (p, ctx) => {
      const snap = snapForArea(p, ctx, { extra: points() });
      showSnap(snap);
      const { drawing, setDrawing } = editorStore.getState();
      if (drawing) setDrawing({ points: drawing.points, hover: snap.point });
    },
    onTap: (p, ctx) => {
      areasUiStore.setState({ notice: null });
      const placed = points();
      const first = placed[0];
      if (placed.length >= 3 && first && distance(p.world, first) <= snapTolerance(p, ctx)) {
        finish(ctx);
        return;
      }
      const snap = snapForArea(p, ctx, { extra: placed });
      showSnap(snap);
      const last = placed.at(-1);
      if (last && distance(last, snap.point) < EPSILON) return;
      editorStore.getState().setDrawing({ points: [...placed, snap.point], hover: snap.point });
    },
    // The first tap of the pair has already placed the corner.
    onDoubleTap: (_p, ctx) => {
      finish(ctx);
    },
    onKeyDown: (e, ctx) => {
      const { drawing, setDrawing } = editorStore.getState();
      if (!drawing) return false;
      if (e.key === 'Enter') {
        finish(ctx);
        return true;
      }
      if (e.key === 'Backspace') {
        const remaining = drawing.points.slice(0, -1);
        setDrawing(remaining.length > 0 ? { points: remaining, hover: drawing.hover } : null);
        areasUiStore.setState({ notice: null });
        return true;
      }
      return false;
    },
    onLeave: () => {
      areasUiStore.setState({ snap: null });
      const { drawing, setDrawing } = editorStore.getState();
      if (drawing?.hover) setDrawing({ points: drawing.points, hover: null });
    },
    onDeactivate: resetAreasUi,
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
    areasUiStore.setState({ notice: null });
    const face = faceUnder(p, ctx);
    if (!face) showNotice(p.world, 'areas.notEnclosed');
    else commit(ctx, 'rooms', face.polygon, p.world);
  },
  onLeave: () => {
    areasUiStore.setState({ fill: null });
  },
  onDeactivate: resetAreasUi,
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
