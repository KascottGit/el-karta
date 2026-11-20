import { centroid, type Pt } from '@el-karta/core';
import { boundsOf, width } from '../canvas/rect';

/** How far below its centre a zone's name goes, so it does not cover a room name at the same spot. */
export const ZONE_LABEL_OFFSET_PX = 16;

export const areaBounds = (area: { polygon: readonly Pt[] }) => boundsOf(area.polygon);

/** Konva's flat [x0, y0, x1, y1, …] form. */
export const flat = (polygon: readonly Pt[]) => polygon.flatMap((p) => [p.x, p.y]);

/** Where an area's name goes, and how wide it may be. */
export function labelPlacement(polygon: readonly Pt[]) {
  const bounds = boundsOf(polygon);
  return { at: centroid(polygon), width: bounds ? 0.9 * width(bounds) : 0 };
}
