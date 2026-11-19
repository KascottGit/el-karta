/** Konva draws to a canvas, so it needs concrete colours rather than the CSS theme variables. */
export const canvasColors = {
  wall: '#334155',
  room: '#f8fafc',
  roomStroke: '#cbd5e1',
  zone: 'rgba(16, 185, 129, 0.10)',
  zoneStroke: '#10b981',
  label: '#475569',
  selected: '#2563eb',
  selectedFill: '#dbeafe',
} as const;

export const canvasFont = '"Geist Variable", system-ui, sans-serif';
