import type { Pt } from '@el-karta/core';
import { editorStore } from '../editor-store';
import type { CanvasContext, CanvasPointer, ResolvedExtensions } from './extension';
import { createGestureController, type PointerInput, type PointerKind } from './gestures';
import type { HandleHit } from './hit';
import { panBy, pinchStep, screenToWorld, type Viewport } from './viewport';

const setView = (update: (vp: Viewport) => Viewport) => {
  const { viewport, setViewport } = editorStore.getState();
  setViewport(update(viewport));
};

/**
 * Routes gestures to the view (pan, pinch), to a handle when a drag starts on one, or else to the
 * active tool. DOM-free apart from the `handleAt` lookup, so it is unit-tested directly.
 */
export function createPointerDispatch({
  registry,
  ctx,
  handleAt,
}: {
  registry: ResolvedExtensions;
  ctx: CanvasContext;
  handleAt: (screen: Pt, kind: PointerKind) => HandleHit | null;
}) {
  const tool = () => registry.tool(editorStore.getState().tool);
  let pressed: HandleHit | null = null;
  let dragging: HandleHit | 'tool' | null = null;

  const toCanvas = (p: PointerInput): CanvasPointer => ({
    world: screenToWorld(editorStore.getState().viewport, p),
    screen: { x: p.x, y: p.y },
    kind: p.kind,
    shiftKey: p.shiftKey,
    altKey: p.altKey,
    modKey: p.modKey,
    onHandle: pressed !== null,
  });

  const gestures = createGestureController({
    hover: (p) => tool().onHover?.(toCanvas(p), ctx),
    tap: (p) => tool().onTap?.(toCanvas(p), ctx),
    doubleTap: (p) => {
      const t = tool();
      if (t.onDoubleTap) t.onDoubleTap(toCanvas(p), ctx);
      else t.onTap?.(toCanvas(p), ctx);
    },
    dragStart: (start, p) => {
      if (pressed) {
        dragging = pressed;
        pressed.handle.onDragStart?.(pressed.payload as never, toCanvas(start), toCanvas(p), ctx);
        return true;
      }
      if (tool().onDragStart?.(toCanvas(start), toCanvas(p), ctx)) {
        dragging = 'tool';
        return true;
      }
      return false;
    },
    drag: (p) => {
      if (dragging === 'tool') tool().onDrag?.(toCanvas(p), ctx);
      else dragging?.handle.onDrag(dragging.payload as never, toCanvas(p), ctx);
    },
    dragEnd: (p) => {
      const ended = dragging;
      dragging = null;
      if (ended === 'tool') tool().onDragEnd?.(toCanvas(p), ctx);
      else ended?.handle.onDragEnd?.(ended.payload as never, toCanvas(p), ctx);
    },
    dragCancel: () => {
      const cancelled = dragging;
      dragging = null;
      if (cancelled === 'tool') tool().onDragCancel?.(ctx);
      else cancelled?.handle.onDragCancel?.(cancelled.payload as never, ctx);
    },
    pan: (dx, dy) => {
      setView((vp) => panBy(vp, dx, dy));
    },
    pinch: (prevA, prevB, a, b) => {
      setView((vp) => pinchStep(vp, prevA, prevB, a, b));
    },
  });

  return {
    get mode() {
      return gestures.mode;
    },
    down(p: PointerInput) {
      if (gestures.mode === 'idle' && p.button === 0 && !p.panKey) pressed = handleAt(p, p.kind);
      gestures.down(p);
      if (gestures.mode !== 'pending') pressed = null;
    },
    move(p: PointerInput) {
      gestures.move(p);
    },
    up(p: PointerInput) {
      gestures.up(p);
      if (gestures.mode === 'idle') pressed = null;
    },
    cancel(p: PointerInput) {
      gestures.cancel(p);
      if (gestures.mode === 'idle') pressed = null;
    },
    leave(p: PointerInput) {
      if (p.kind !== 'touch' && gestures.mode === 'idle') tool().onLeave?.(ctx);
    },
    /** Escape or unmount: cancels a tool or handle drag in progress. */
    cancelDrag(): boolean {
      pressed = null;
      return gestures.cancelDrag();
    },
  };
}

export type PointerDispatch = ReturnType<typeof createPointerDispatch>;
