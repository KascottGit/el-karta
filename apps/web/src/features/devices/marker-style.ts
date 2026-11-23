import type { Pt } from '@el-karta/core';
import { canvasColors } from '@/features/floorplan/canvas/theme';
import type { MarkerShape } from './appearance';
import type { MarkerStyle } from './marker-sprites';

export const MARKER_PX = 7;
export const SELECTED_MARKER_PX = 9;
const OUTLINE = '#ffffff';
export const OUTLINE_PX = 1.5;
export const SELECTED_OUTLINE_PX = 2.5;
export const FOOTPRINT_ALPHA = 0.25;

/** Markers that look the same, so one sprite paints them all. */
export interface MarkerGroup {
  style: MarkerStyle;
  at: Pt[];
}

export const markerStyle = (
  shape: MarkerShape,
  fill: string,
  look: 'plain' | 'selected',
): MarkerStyle =>
  look === 'plain'
    ? { shape, fill, stroke: OUTLINE, radiusPx: MARKER_PX, lineWidthPx: OUTLINE_PX }
    : {
        shape,
        fill,
        stroke: canvasColors.selected,
        radiusPx: SELECTED_MARKER_PX,
        lineWidthPx: SELECTED_OUTLINE_PX,
      };
