export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** One mouse wheel notch in Chrome, Edge and Firefox on Windows and Linux is 100–120 device pixels. */
const NOTCH_MIN_DEVICE_PX = 50;
const WHOLE_TOLERANCE = 0.01;
const PIXEL_MODE = 0;

/**
 * Browsers cannot say whether a wheel event comes from a mouse or a trackpad, so the rule is:
 * - a trackpad pinch (ctrlKey) and Ctrl/Cmd + wheel zoom; Shift + wheel pans;
 * - line or page deltas are mouse notches and zoom;
 * - pixel deltas zoom when they look like a notch: vertical only and a whole number of at least 50
 *   device pixels. Multiplying by the device pixel ratio undoes browser zoom (a 100 px notch is
 *   90.909 CSS px at 110 %) and display scaling;
 * - everything else pans. That includes trackpad scrolling, and the small notches of a mouse on
 *   macOS (about 4 px), which cannot be told apart from a trackpad: on a Mac, zoom with a pinch or
 *   Cmd + wheel.
 */
export function wheelIntent(e: WheelInput, devicePixelRatio: number): 'zoom' | 'pan' {
  if (e.ctrlKey || e.metaKey) return 'zoom';
  if (e.shiftKey) return 'pan';
  if (e.deltaMode !== PIXEL_MODE) return 'zoom';
  const device = Math.abs(e.deltaY * devicePixelRatio);
  const notch =
    e.deltaX === 0 &&
    device >= NOTCH_MIN_DEVICE_PX &&
    Math.abs(device - Math.round(device)) < WHOLE_TOLERANCE;
  return notch ? 'zoom' : 'pan';
}
