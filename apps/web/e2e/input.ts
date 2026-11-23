import type { CDPSession, Page } from '@playwright/test';
import type { Pt } from './app-modules';

/** Sends raw touch events, for drags and multi-finger gestures Playwright's touchscreen lacks. */
export const touch = (
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: Pt[],
) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, id) => ({ ...p, id })),
  });

/** One finger from `from` to `to` in ten steps. */
export async function fingerDrag(cdp: CDPSession, from: Pt, to: Pt) {
  await touch(cdp, 'touchStart', [from]);
  for (let i = 1; i <= 10; i++) {
    await touch(cdp, 'touchMove', [
      { x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 },
    ]);
  }
  await touch(cdp, 'touchEnd', []);
}

/** Taps, drags and button presses, so one test body runs with a mouse and with a finger. */
export interface Input {
  tap(at: Pt): Promise<void>;
  drag(from: Pt, to: Pt): Promise<void>;
  button(name: string): Promise<void>;
}

export const mouse = (page: Page): Input => ({
  tap: (at) => page.mouse.click(at.x, at.y),
  drag: async (from, to) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
  },
  button: (name) => page.getByRole('button', { name, exact: true }).click(),
});

export async function finger(page: Page): Promise<Input> {
  const cdp = await page.context().newCDPSession(page);
  return {
    tap: (at) => page.touchscreen.tap(at.x, at.y),
    drag: (from, to) => fingerDrag(cdp, from, to),
    button: (name) => page.getByRole('button', { name, exact: true }).tap(),
  };
}
