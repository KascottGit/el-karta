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

export const canvasFont = '"Geist Variable", system-ui, sans-serif';
