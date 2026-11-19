import { describe, expect, it, vi } from 'vitest';
import { createGestureController, type GestureHandlers, type PointerInput } from './gestures';

function setup(options: { toolDrags?: boolean } = {}) {
  const calls: string[] = [];
  const handlers: GestureHandlers = {
    hover: (p) => calls.push(`hover ${p.x},${p.y}`),
    tap: (p) => calls.push(`tap ${p.x},${p.y}`),
    doubleTap: (p) => calls.push(`doubleTap ${p.x},${p.y}`),
    dragStart: vi.fn((start: PointerInput, p: PointerInput) => {
      calls.push(`dragStart ${start.x},${start.y}→${p.x},${p.y}`);
      return options.toolDrags ?? false;
    }),
    drag: (p) => calls.push(`drag ${p.x},${p.y}`),
    dragEnd: (p) => calls.push(`dragEnd ${p.x},${p.y}`),
    dragCancel: () => calls.push('dragCancel'),
    pan: (dx, dy) => calls.push(`pan ${dx},${dy}`),
    pinch: (prevA, prevB, a, b) =>
      calls.push(`pinch ${prevA.x},${prevB.x}→${a.x},${b.x} ${a.y},${b.y}`),
  };
  return { calls, gestures: createGestureController(handlers) };
}

let clock = 0;
const mouse = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({
  id: 1,
  kind: 'mouse',
  button: 0,
  buttons: 1,
  x,
  y,
  time: (clock += 100),
  claimed: false,
  panKey: false,
  shiftKey: false,
  altKey: false,
  modKey: false,
  ...extra,
});
const touch = (id: number, x: number, y: number) => mouse(x, y, { id, kind: 'touch' });

describe('gesture controller', () => {
  it('reports a press and release without movement as a tap, and hovers in between', () => {
    const { calls, gestures } = setup();
    gestures.move(mouse(5, 5, { buttons: 0 }));
    gestures.down(mouse(10, 10));
    gestures.move(mouse(12, 11));
    gestures.up(mouse(12, 11));
    clock += 1000;
    gestures.move(mouse(20, 20, { buttons: 0 }));
    expect(calls).toEqual(['hover 5,5', 'tap 12,11', 'hover 20,20']);
  });

  it('turns a drag the tool does not take into a pan that includes the threshold distance', () => {
    const { calls, gestures } = setup();
    gestures.down(mouse(10, 10));
    gestures.move(mouse(20, 10));
    gestures.move(mouse(25, 13));
    gestures.up(mouse(25, 13));
    expect(calls).toEqual(['dragStart 10,10→20,10', 'pan 10,0', 'pan 5,3']);
    expect(gestures.mode).toBe('idle');
  });

  it('gives the drag to a tool that takes it', () => {
    const { calls, gestures } = setup({ toolDrags: true });
    gestures.down(mouse(0, 0));
    gestures.move(mouse(10, 0));
    gestures.move(mouse(20, 0));
    gestures.up(mouse(20, 0));
    expect(calls).toEqual(['dragStart 0,0→10,0', 'drag 10,0', 'drag 20,0', 'dragEnd 20,0']);
  });

  it('pans with the middle button or with space held, whatever the tool', () => {
    const { calls, gestures } = setup({ toolDrags: true });
    gestures.down(mouse(0, 0, { button: 1, buttons: 4 }));
    gestures.move(mouse(1, 2, { buttons: 4 }));
    gestures.up(mouse(1, 2, { button: 1, buttons: 0 }));
    gestures.down(mouse(0, 0, { panKey: true }));
    gestures.move(mouse(3, 4, { panKey: true }));
    gestures.up(mouse(3, 4));
    expect(calls).toEqual(['pan 1,2', 'pan 3,4']);
  });

  it('detects a double tap close in time and place', () => {
    const { calls, gestures } = setup();
    clock = 0;
    gestures.down(mouse(10, 10));
    gestures.up(mouse(10, 10));
    gestures.down(mouse(12, 10));
    gestures.up(mouse(12, 10));
    gestures.down(mouse(12, 10));
    gestures.up(mouse(12, 10));
    clock += 1000;
    gestures.down(mouse(12, 10));
    gestures.up(mouse(12, 10));
    expect(calls).toEqual(['tap 10,10', 'doubleTap 12,10', 'tap 12,10', 'tap 12,10']);
  });

  it('ignores a gesture claimed by a Konva shape until its pointer is released', () => {
    const { calls, gestures } = setup();
    gestures.down(mouse(0, 0, { claimed: true }));
    gestures.move(mouse(50, 50));
    gestures.up(mouse(50, 50));
    gestures.move(mouse(60, 60, { buttons: 0 }));
    expect(calls).toEqual(['hover 60,60']);
  });

  it('ignores the right button', () => {
    const { calls, gestures } = setup();
    gestures.down(mouse(0, 0, { button: 2, buttons: 2 }));
    gestures.move(mouse(50, 50, { buttons: 2 }));
    gestures.up(mouse(50, 50, { button: 2 }));
    expect(calls).toEqual([]);
  });

  it('pinches with two fingers, then keeps panning with the one left', () => {
    const { calls, gestures } = setup();
    gestures.down(touch(1, 100, 100));
    gestures.down(touch(2, 200, 100));
    gestures.move(touch(2, 300, 100));
    gestures.move(touch(1, 90, 110));
    gestures.up(touch(1, 90, 110));
    gestures.move(touch(2, 310, 120));
    gestures.up(touch(2, 310, 120));
    expect(calls).toEqual([
      'pinch 100,200→100,300 100,100',
      'pinch 100,300→90,300 110,100',
      'pan 10,20',
    ]);
    expect(gestures.mode).toBe('idle');
  });

  it('cancels a tool drag when a second finger lands, and never taps', () => {
    const { calls, gestures } = setup({ toolDrags: true });
    gestures.down(touch(1, 0, 0));
    gestures.move(touch(1, 20, 0));
    gestures.down(touch(2, 100, 0));
    gestures.up(touch(2, 100, 0));
    gestures.up(touch(1, 20, 0));
    expect(calls).toEqual(['dragStart 0,0→20,0', 'drag 20,0', 'dragCancel']);
  });

  it('uses a larger drag threshold for touch, so a shaky tap is still a tap', () => {
    const { calls, gestures } = setup();
    gestures.down(touch(1, 0, 0));
    gestures.move(touch(1, 5, 5));
    gestures.up(touch(1, 5, 5));
    expect(calls).toEqual(['tap 5,5']);
  });

  it('ends a tool drag with dragCancel when the browser cancels the pointer', () => {
    const { calls, gestures } = setup({ toolDrags: true });
    gestures.down(mouse(0, 0));
    gestures.move(mouse(10, 0));
    gestures.cancel(mouse(10, 0));
    expect(calls).toEqual(['dragStart 0,0→10,0', 'drag 10,0', 'dragCancel']);
    expect(gestures.mode).toBe('idle');
  });
});
