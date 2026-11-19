import type { Pt } from '@el-karta/core';
import { boundsOf } from '../canvas/rect';

export const areaBounds = (area: { polygon: readonly Pt[] }) => boundsOf(area.polygon);
