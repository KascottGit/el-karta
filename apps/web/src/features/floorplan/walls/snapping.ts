import { snapPoint, type Snap, type SnapOptions } from '@el-karta/core';
import { modelStore } from '@/model/store';
import type { CanvasContext, CanvasPointer } from '../canvas/extension';
import type { PointerKind } from '../canvas/gestures';
import { wallsStore } from './walls-store';

/** Snap and hit reach in screen pixels; a fingertip covers more than a cursor. */
export const SNAP_PX: Readonly<Record<PointerKind, number>> = { mouse: 10, pen: 12, touch: 20 };

export const snapTolerance = (p: CanvasPointer, ctx: CanvasContext) =>
  ctx.pxToWorld(SNAP_PX[p.kind]);

/** Snaps the pointer on the current floor, unless snapping is off or Alt is held. */
export function snapPointer(
  p: CanvasPointer,
  ctx: CanvasContext,
  options: Omit<SnapOptions, 'tolerance'> = {},
): Snap {
  const floor = modelStore.getState().model?.floors[ctx.floorId];
  if (!floor || !wallsStore.getState().snapping || p.altKey)
    return { point: p.world, kind: 'none', targets: [] };
  return snapPoint(floor.data, p.world, { ...options, tolerance: snapTolerance(p, ctx) });
}
