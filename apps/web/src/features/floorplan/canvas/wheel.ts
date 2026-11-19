export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Smallest pixel delta Chrome and Safari report for one mouse wheel notch is around 50–100. */
const NOTCH_MIN = 50;
const PIXEL_MODE = 0;

/**
 * Browsers cannot say whether a wheel event comes from a mouse or a trackpad, so: a trackpad pinch
 * (ctrlKey) and Ctrl/Cmd + wheel zoom; line or page deltas, or large whole-number vertical pixel
 * deltas, are mouse notches and zoom; other pixel deltas are trackpad scrolling and pan. Shift pans.
 */
export function wheelIntent(e: WheelInput): 'zoom' | 'pan' {
  if (e.ctrlKey || e.metaKey) return 'zoom';
  if (e.shiftKey) return 'pan';
  if (e.deltaMode !== PIXEL_MODE) return 'zoom';
  const notch = e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= NOTCH_MIN;
  return notch ? 'zoom' : 'pan';
}
