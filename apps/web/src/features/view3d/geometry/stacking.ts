import type { FloorData, Id } from '@el-karta/core';

export interface StackedFloor {
  id: Id;
  data: Pick<FloorData, 'elevation' | 'height'>;
}

/**
 * The z at which each visible floor is drawn. Floors sit at their `elevation`; exploded, each one
 * is also raised by the heights of the visible floors below it, which leaves a gap of one floor
 * height between them.
 */
export function floorBases(visible: readonly StackedFloor[], exploded: boolean): Map<Id, number> {
  const bases = new Map<Id, number>();
  let gap = 0;
  for (const floor of [...visible].sort((p, q) => p.data.elevation - q.data.elevation)) {
    bases.set(floor.id, floor.data.elevation + gap);
    if (exploded) gap += floor.data.height;
  }
  return bases;
}
