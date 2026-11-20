import type { Pt } from '@el-karta/core';
import { boundsOf } from '../canvas/rect';

export const areaBounds = (area: { polygon: readonly Pt[] }) => boundsOf(area.polygon);

/** Konva's flat [x0, y0, x1, y1, …] form. */
export const flat = (polygon: readonly Pt[]) => polygon.flatMap((p) => [p.x, p.y]);
