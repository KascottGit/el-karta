import type { IssueSeverity } from '@el-karta/core';

/**
 * Colours shared by every feature. Konva draws to a canvas, so it needs concrete colours rather
 * than the CSS theme variables. Feature-specific colours live with the feature.
 */
export const canvasColors = {
  label: '#475569',
  selected: '#2563eb',
  selectedFill: '#dbeafe',
  snap: '#db2777',
} as const;

/** Outlines and markers of items the validator flags, by the worst severity. */
export const issueColors: Readonly<Record<IssueSeverity, string>> = {
  error: '#dc2626',
  warning: '#f59e0b',
};

/**
 * How suggested items (AI or rules) are drawn, so they never look like confirmed data: translucent,
 * dashed, and coloured by confidence.
 */
export const suggestionStyle = {
  opacity: 0.55,
  dash: [6, 4],
  stroke: { high: '#7c3aed', medium: '#a855f7', low: '#d946ef' },
  /** Confidence at or above `high` counts as high; below `medium` as low. */
  thresholds: { high: 0.8, medium: 0.5 },
} as const;

export const canvasFont = '"Geist Variable", system-ui, sans-serif';
