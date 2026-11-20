import type { Pt } from '@el-karta/core';
import { contains, expand, height, width, type Rect } from './rect';

/** Maps world metres to screen pixels: `screen = world * scale + (x, y)`. Both have y pointing down. */
export interface Viewport {
  x: number;
  y: number;
  /** Screen pixels per metre. */
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The world area the renderers draw, larger than the view so that panning rarely re-renders React. */
export interface RenderWindow {
  rect: Rect;
  /** The view's scale when the window was chosen, for zoom-dependent detail such as label size. */
  scale: number;
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 5000;
const DEFAULT_SCALE = 40;
const WINDOW_MARGIN = 0.5;
const WINDOW_MAX_ZOOM_CHANGE = 1.5;

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export const worldToScreen = (vp: Viewport, p: Pt): Pt => ({
  x: p.x * vp.scale + vp.x,
  y: p.y * vp.scale + vp.y,
});

export const screenToWorld = (vp: Viewport, p: Pt): Pt => ({
  x: (p.x - vp.x) / vp.scale,
  y: (p.y - vp.y) / vp.scale,
});

export const panBy = (vp: Viewport, dx: number, dy: number): Viewport => ({
  ...vp,
  x: vp.x + dx,
  y: vp.y + dy,
});

/** Scales the view by `factor` while keeping the world point under `anchor` (screen) in place. */
export function zoomAt(vp: Viewport, anchor: Pt, factor: number): Viewport {
  const scale = clampScale(vp.scale * factor);
  const world = screenToWorld(vp, anchor);
  return { scale, x: anchor.x - world.x * scale, y: anchor.y - world.y * scale };
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** One step of a two-finger gesture: zooms by the change in finger distance and pans with their midpoint. */
export function pinchStep(vp: Viewport, prevA: Pt, prevB: Pt, a: Pt, b: Pt): Viewport {
  const before = Math.hypot(prevA.x - prevB.x, prevA.y - prevB.y);
  const after = Math.hypot(a.x - b.x, a.y - b.y);
  const factor = before > 0 && after > 0 ? after / before : 1;
  const world = screenToWorld(vp, mid(prevA, prevB));
  const center = mid(a, b);
  const scale = clampScale(vp.scale * factor);
  return { scale, x: center.x - world.x * scale, y: center.y - world.y * scale };
}

/** The view that shows `rect` centred with `padding` pixels around it. */
export function fitRect(rect: Rect | null, size: Size, padding = 24): Viewport {
  const center = rect
    ? { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 }
    : { x: 0, y: 0 };
  const availableW = Math.max(1, size.width - 2 * padding);
  const availableH = Math.max(1, size.height - 2 * padding);
  const candidates = rect
    ? [
        width(rect) > 0 ? availableW / width(rect) : Infinity,
        height(rect) > 0 ? availableH / height(rect) : Infinity,
      ]
    : [];
  const fitted = Math.min(...candidates);
  const scale = clampScale(Number.isFinite(fitted) ? fitted : DEFAULT_SCALE);
  return {
    scale,
    x: size.width / 2 - center.x * scale,
    y: size.height / 2 - center.y * scale,
  };
}

export function visibleRect(vp: Viewport, size: Size): Rect {
  const topLeft = screenToWorld(vp, { x: 0, y: 0 });
  const bottomRight = screenToWorld(vp, { x: size.width, y: size.height });
  return { minX: topLeft.x, minY: topLeft.y, maxX: bottomRight.x, maxY: bottomRight.y };
}

/** Keeps the current window while it still covers the view at about the same zoom; otherwise picks a new one. */
export function nextRenderWindow(
  current: RenderWindow | null,
  vp: Viewport,
  size: Size,
): RenderWindow {
  const visible = visibleRect(vp, size);
  if (
    current &&
    contains(current.rect, visible) &&
    Math.abs(Math.log(vp.scale / current.scale)) < Math.log(WINDOW_MAX_ZOOM_CHANGE)
  ) {
    return current;
  }
  return { rect: expand(visible, WINDOW_MARGIN), scale: vp.scale };
}
