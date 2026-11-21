import type { FloorScale, Id, Pt } from '@el-karta/core';

/** A scale the person set with the scale tool, and how the plan around it changed. */
export interface ScaleMeasured {
  floorId: Id;
  scale: FloorScale;
  /** How much larger the image now is in the plan. */
  growth: number;
  /** The plan point that stayed put. */
  pivot: Pt;
}

type Listener = (event: ScaleMeasured) => void;

const listeners = new Set<Listener>();

/**
 * Listens for scales set with the scale tool. Undo, redo and other people's changes do not count:
 * they are not someone correcting the scale, so nothing should be re-measured because of them.
 */
export function onScaleMeasured(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitScaleMeasured(event: ScaleMeasured) {
  for (const listener of listeners) listener(event);
}
