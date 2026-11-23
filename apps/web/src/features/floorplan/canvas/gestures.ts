import type { Pt } from '@el-karta/core';

export type PointerKind = 'mouse' | 'pen' | 'touch';

/** The parts of a DOM PointerEvent the controller needs, in container pixels. */
export interface PointerInput {
  id: number;
  kind: PointerKind;
  button: number;
  buttons: number;
  x: number;
  y: number;
  time: number;
  /** Space is held, so a primary drag pans whatever the tool. */
  panKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** Ctrl, or Cmd on a Mac. */
  modKey: boolean;
}

export interface GestureHandlers {
  hover(p: PointerInput): void;
  tap(p: PointerInput): void;
  doubleTap(p: PointerInput): void;
  /** Called once a press has moved far enough to be a drag. Returning false makes the drag pan. */
  dragStart(start: PointerInput, p: PointerInput): boolean;
  drag(p: PointerInput): void;
  dragEnd(p: PointerInput): void;
  /** A tool drag was interrupted, e.g. by a second finger. */
  dragCancel(): void;
  pan(dx: number, dy: number): void;
  pinch(prevA: Pt, prevB: Pt, a: Pt, b: Pt): void;
}

const pointerKind = (type: string): PointerKind =>
  type === 'touch' || type === 'pen' ? type : 'mouse';

/** A DOM pointer event as gesture input, in CSS pixels relative to `el`. */
export function pointerInput(e: PointerEvent, el: Element, panKey: boolean): PointerInput {
  const rect = el.getBoundingClientRect();
  return {
    id: e.pointerId,
    kind: pointerKind(e.pointerType),
    button: e.button,
    buttons: e.buttons,
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    time: e.timeStamp,
    panKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    modKey: e.ctrlKey || e.metaKey,
  };
}

export const DRAG_THRESHOLD: Readonly<Record<PointerKind, number>> = { mouse: 3, pen: 4, touch: 8 };
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DISTANCE: Readonly<Record<PointerKind, number>> = { mouse: 6, pen: 12, touch: 24 };
const MIDDLE_BUTTON = 1;

type Mode =
  | { kind: 'idle' }
  | { kind: 'pending'; owner: number; start: PointerInput }
  | { kind: 'drag'; owner: number }
  | { kind: 'pan'; owner: number; last: Pt }
  | { kind: 'pinch' }
  /** A cancelled press: its pointer is ignored until released. */
  | { kind: 'ignored'; owner: number };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Turns raw pointer events into taps, drags, pans and pinches. Kept free of the DOM so it can be
 * unit-tested; `floor-canvas.tsx` feeds it events and routes the results to the tool and viewport.
 */
export function createGestureController(handlers: GestureHandlers) {
  const touches = new Map<number, Pt>();
  let mode: Mode = { kind: 'idle' };
  let lastTap: PointerInput | null = null;

  return {
    get mode(): Mode['kind'] {
      return mode.kind;
    },

    down(p: PointerInput) {
      if (p.kind === 'touch') touches.set(p.id, { x: p.x, y: p.y });
      if (p.kind === 'touch' && touches.size >= 2) {
        if (mode.kind === 'drag') handlers.dragCancel();
        mode = { kind: 'pinch' };
        return;
      }
      if (mode.kind !== 'idle') return;
      if (p.button === MIDDLE_BUTTON || (p.button === 0 && p.panKey))
        mode = { kind: 'pan', owner: p.id, last: p };
      else if (p.button === 0) mode = { kind: 'pending', owner: p.id, start: p };
    },

    move(p: PointerInput) {
      const prevTouch = touches.get(p.id);
      if (prevTouch) touches.set(p.id, { x: p.x, y: p.y });
      switch (mode.kind) {
        case 'idle':
          if (p.kind !== 'touch' && p.buttons === 0) handlers.hover(p);
          return;
        case 'pending': {
          if (p.id !== mode.owner) return;
          const { start } = mode;
          if (dist(start, p) <= DRAG_THRESHOLD[p.kind]) return;
          if (handlers.dragStart(start, p)) {
            mode = { kind: 'drag', owner: p.id };
            handlers.drag(p);
          } else {
            mode = { kind: 'pan', owner: p.id, last: p };
            handlers.pan(p.x - start.x, p.y - start.y);
          }
          return;
        }
        case 'drag':
          if (p.id === mode.owner) handlers.drag(p);
          return;
        case 'pan':
          if (p.id !== mode.owner) return;
          handlers.pan(p.x - mode.last.x, p.y - mode.last.y);
          mode = { ...mode, last: p };
          return;
        case 'pinch': {
          const [first, second] = touches.entries();
          if (!prevTouch || !first || !second) return;
          const [idA, a] = first;
          const [idB, b] = second;
          handlers.pinch(idA === p.id ? prevTouch : a, idB === p.id ? prevTouch : b, a, b);
          return;
        }
        case 'ignored':
          return;
      }
    },

    up(p: PointerInput) {
      touches.delete(p.id);
      switch (mode.kind) {
        case 'pending':
          if (p.id !== mode.owner) return;
          mode = { kind: 'idle' };
          if (
            lastTap &&
            lastTap.kind === p.kind &&
            p.time - lastTap.time <= DOUBLE_TAP_MS &&
            dist(lastTap, p) <= DOUBLE_TAP_DISTANCE[p.kind]
          ) {
            lastTap = null;
            handlers.doubleTap(p);
          } else {
            lastTap = p;
            handlers.tap(p);
          }
          return;
        case 'drag':
          if (p.id !== mode.owner) return;
          mode = { kind: 'idle' };
          handlers.dragEnd(p);
          return;
        case 'pinch': {
          const [remaining] = touches.entries();
          // Lifting one finger of a pinch continues as a one-finger pan, as in map apps.
          mode = remaining
            ? { kind: 'pan', owner: remaining[0], last: remaining[1] }
            : { kind: 'idle' };
          return;
        }
        case 'pan':
        case 'ignored':
          if (p.id === mode.owner) mode = { kind: 'idle' };
          return;
        case 'idle':
          return;
      }
    },

    /** Cancels a tool or handle drag in progress (Escape, unmount). Returns whether there was one. */
    cancelDrag(): boolean {
      if (mode.kind !== 'drag') return false;
      mode = { kind: 'ignored', owner: mode.owner };
      handlers.dragCancel();
      return true;
    },

    cancel(p: PointerInput) {
      touches.delete(p.id);
      if (mode.kind === 'drag' && p.id === mode.owner) handlers.dragCancel();
      if (mode.kind === 'pinch' ? touches.size === 0 : 'owner' in mode && mode.owner === p.id)
        mode = { kind: 'idle' };
    },
  };
}

export type GestureController = ReturnType<typeof createGestureController>;
