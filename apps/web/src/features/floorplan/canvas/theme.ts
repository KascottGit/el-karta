/**
 * Colours shared by every feature. Konva draws to a canvas, so it needs concrete colours rather
 * than the CSS theme variables. Feature-specific colours live with the feature.
 */
export const canvasColors = {
  label: '#475569',
  selected: '#2563eb',
  selectedFill: '#dbeafe',
} as const;

export const canvasFont = '"Geist Variable", system-ui, sans-serif';
