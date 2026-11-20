import { snapPoint, type Snap, type SnapOptions } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { modelStore } from '@/model/store';
import type { CanvasContext, CanvasPointer } from '../canvas/extension';
import type { PointerKind } from '../canvas/gestures';

/** Snap and hit reach in screen pixels; a fingertip covers more than a cursor. */
export const SNAP_PX: Readonly<Record<PointerKind, number>> = { mouse: 10, pen: 12, touch: 20 };

export const snapTolerance = (p: CanvasPointer, ctx: CanvasContext) =>
  ctx.pxToWorld(SNAP_PX[p.kind]);

/** Whether drawing tools snap at all. UI-only and kept for the session, shared by every tool. */
export const snappingStore = createStore<{ enabled: boolean }>()(() => ({ enabled: true }));

export const useSnappingEnabled = () => useStore(snappingStore, (s) => s.enabled);

export const setSnapping = (enabled: boolean) => {
  snappingStore.setState({ enabled });
};

/** Snaps the pointer on the current floor, unless snapping is off or Alt is held. */
export function snapPointer(
  p: CanvasPointer,
  ctx: CanvasContext,
  options: Omit<SnapOptions, 'tolerance'> = {},
): Snap {
  const floor = modelStore.getState().model?.floors[ctx.floorId];
  if (!floor || !snappingStore.getState().enabled || p.altKey)
    return { point: p.world, kind: 'none', targets: [] };
  return snapPoint(floor.data, p.world, { ...options, tolerance: snapTolerance(p, ctx) });
}
