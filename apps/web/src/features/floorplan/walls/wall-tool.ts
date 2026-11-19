import { distance, type Pt, type Wall } from '@el-karta/core';
import { BrickWall } from 'lucide-react';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import type { CanvasContext, CanvasPointer, Tool } from '../canvas/extension';
import { MIN_WALL_LENGTH, putWalls } from './corner';
import { snapPointer, snapTolerance } from './snapping';
import { wallsStore } from './walls-store';

export const WALL_TOOL = 'wall';

const points = (): readonly Pt[] => editorStore.getState().drawing?.points ?? [];

/** Snaps the pointer against the floor and the polyline so far, and shows it as the hover point. */
function preview(p: CanvasPointer, ctx: CanvasContext): Pt {
  const placed = points();
  const last = placed.at(-1);
  const snap = snapPointer(p, ctx, { from: last ? [last] : [], points: placed });
  wallsStore.setState({ snap });
  const { drawing, setDrawing } = editorStore.getState();
  if (drawing) setDrawing({ points: drawing.points, hover: snap.point });
  return snap.point;
}

/**
 * Adds the polyline being drawn to its floor as one wall per segment, in one undoable edit, and
 * stops drawing. A polyline of a single point adds nothing.
 */
export function finishWalls() {
  const { drawing, setDrawing } = editorStore.getState();
  const { drawingFloorId: floorId, thickness } = wallsStore.getState();
  if (drawing) setDrawing(null);
  wallsStore.setState({ drawingFloorId: null, snap: null });
  if (!drawing || !floorId || !modelStore.getState().model?.floors[floorId]) return;
  const walls: Wall[] = [];
  drawing.points.forEach((b, i) => {
    const a = drawing.points[i - 1];
    if (a && distance(a, b) >= MIN_WALL_LENGTH)
      walls.push({ id: crypto.randomUUID(), a, b, thickness, provenance: { status: 'manual' } });
  });
  if (walls.length > 0) modelStore.getState().apply(putWalls(floorId, walls));
}

/** Places a point; a tap on the last point finishes, and one on the first point closes the loop and finishes. */
function place(p: CanvasPointer, ctx: CanvasContext) {
  const point = preview(p, ctx);
  const { drawing, setDrawing } = editorStore.getState();
  const placed = drawing?.points ?? [];
  const first = placed[0];
  const last = placed.at(-1);
  if (!first || !last) {
    setDrawing({ points: [point], hover: point });
    wallsStore.setState({ drawingFloorId: ctx.floorId });
    return;
  }
  if (distance(point, last) < MIN_WALL_LENGTH || distance(p.world, last) <= snapTolerance(p, ctx)) {
    finishWalls();
    return;
  }
  setDrawing({ points: [...placed, point], hover: point });
  if (placed.length >= 2 && distance(point, first) < MIN_WALL_LENGTH) finishWalls();
}

function removeLastPoint() {
  const { drawing, setDrawing } = editorStore.getState();
  if (!drawing) return;
  const remaining = drawing.points.slice(0, -1);
  if (remaining.length === 0) {
    setDrawing(null);
    wallsStore.setState({ drawingFloorId: null });
  } else setDrawing({ points: remaining, hover: drawing.hover });
}

/**
 * Draws walls as a polyline: each click or tap places a corner, snapped to walls, the grid and
 * 45° steps. Double-click, Enter, Escape or a tap on the last point finishes. On a phone, dragging
 * from the last point places the next one where the finger is lifted.
 */
export const wallTool: Tool = {
  id: WALL_TOOL,
  label: 'walls.tool',
  icon: BrickWall,
  order: 10,
  shortcut: 'w',
  cursor: 'crosshair',
  onHover: (p, ctx) => {
    preview(p, ctx);
  },
  onTap: place,
  onDoubleTap: () => {
    finishWalls();
  },
  onDragStart: (start, p, ctx) => {
    const last = points().at(-1);
    if (!last || distance(start.world, last) > snapTolerance(start, ctx)) return false;
    preview(p, ctx);
    return true;
  },
  onDrag: preview,
  onDragEnd: place,
  onDragCancel: () => {
    const { drawing, setDrawing } = editorStore.getState();
    if (drawing) setDrawing({ points: drawing.points, hover: drawing.points.at(-1) ?? null });
    wallsStore.setState({ snap: null });
  },
  onKeyDown: (e) => {
    if (!editorStore.getState().drawing) return false;
    if (e.key === 'Enter' || e.key === 'Escape') {
      finishWalls();
      return true;
    }
    const undo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
    if (e.key === 'Backspace' || undo) {
      removeLastPoint();
      return true;
    }
    return false;
  },
  onLeave: () => {
    const { drawing, setDrawing } = editorStore.getState();
    if (drawing) setDrawing({ points: drawing.points, hover: null });
    wallsStore.setState({ snap: null });
  },
  onDeactivate: () => {
    finishWalls();
  },
};
