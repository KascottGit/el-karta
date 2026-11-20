import type { PointerInput } from './gestures';

/** Pointer inputs for unit tests, 100 ms apart unless `time` is given. */
export function pointerFixtures() {
  let clock = 0;
  const mouse = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({
    id: 1,
    kind: 'mouse',
    button: 0,
    buttons: 1,
    x,
    y,
    time: (clock += 100),
    panKey: false,
    shiftKey: false,
    altKey: false,
    modKey: false,
    ...extra,
  });
  const touch = (id: number, x: number, y: number) => mouse(x, y, { id, kind: 'touch' });
  const wait = (ms: number) => {
    clock += ms;
  };
  return { mouse, touch, wait };
}
