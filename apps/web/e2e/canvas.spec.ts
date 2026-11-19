import { expect, test, type Locator, type Page } from '@playwright/test';
import { readEditor, readTestHandle } from './app-modules';

/** Konva draws on the next animation frame, so wait until two screenshots agree. */
async function settledScreenshot(locator: Locator) {
  let previous = await locator.screenshot();
  for (;;) {
    const next = await locator.screenshot();
    if (Buffer.compare(previous, next) === 0) return next;
    previous = next;
  }
}

async function openSmall(page: Page, query = '') {
  await page.goto(`/dev/synthetic/small${query}`);
  const canvas = page.getByTestId('floor-editor-canvas');
  await expect(canvas.locator('canvas').first()).toBeVisible();
  return { canvas, box: (await canvas.boundingBox())! };
}

/** Opens the editor with the dev test handle and returns its position on the page. */
async function openWithTestHandle(page: Page) {
  const { box } = await openSmall(page, '?test-handle');
  const { viewport } = await readEditor(page);
  const { at } = await readTestHandle(page);
  const toPage = (world: { x: number; y: number }) => ({
    x: box.x + world.x * viewport.scale + viewport.x,
    y: box.y + world.y * viewport.scale + viewport.y,
  });
  return { viewport, start: at, handle: toPage(at), toWorld: (dx: number) => dx / viewport.scale };
}

test('a mouse drag on a handle moves the handle, not the view or the selection; Escape cancels', async ({
  page,
}) => {
  const { viewport, start, handle, toWorld } = await openWithTestHandle(page);

  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 40, handle.y + 20, { steps: 8 });
  await page.mouse.up();
  const moved = await readTestHandle(page);
  expect(moved.events[0]).toBe('start:mouse');
  expect(moved.events.at(-1)).toBe('end');
  expect(moved.at.x).toBeCloseTo(start.x + toWorld(40), 5);
  expect(moved.at.y).toBeCloseTo(start.y + toWorld(20), 5);
  expect(await readEditor(page)).toMatchObject({ viewport, selection: 0 });

  const from = { x: handle.x + 40, y: handle.y + 20 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.move(from.x + 90, from.y, { steps: 3 });
  await page.mouse.up();
  const cancelled = await readTestHandle(page);
  expect(cancelled.events.at(-1)).toBe('cancel');
  expect(cancelled.at).toEqual(moved.at);
  expect(await readEditor(page)).toMatchObject({ viewport, selection: 0, tool: 'select' });
});

test('selecting a wall, deselecting it with Escape, deleting it with the keyboard, undo and redo', async ({
  page,
}) => {
  const { canvas, box } = await openSmall(page);
  const remove = page.getByRole('button', { name: 'Ta bort markerade' });
  const undo = page.getByRole('button', { name: 'Ångra' });
  const redo = page.getByRole('button', { name: 'Gör om' });
  await expect(remove).toBeDisabled();
  await expect(undo).toBeDisabled();

  // The small villa is fitted to the canvas, so its outer wall runs just inside the left padding.
  const before = await settledScreenshot(canvas);
  let x = box.x + 10;
  for (; x < box.x + box.width / 2 && (await remove.isDisabled()); x += 2) {
    await page.mouse.click(x, box.y + box.height / 2);
  }
  await expect(remove).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(remove).toBeDisabled();
  await page.mouse.click(x - 2, box.y + box.height / 2);
  await expect(remove).toBeEnabled();

  await page.keyboard.press('Delete');
  await expect(remove).toBeDisabled();
  await expect(undo).toBeEnabled();
  const deleted = await settledScreenshot(canvas);
  expect(Buffer.compare(before, deleted)).not.toBe(0);

  await page.keyboard.press('Control+z');
  await expect(redo).toBeEnabled();
  await expect(undo).toBeDisabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('two fingers pinch-zoom the plan', async ({ page }) => {
    const { box } = await openSmall(page);
    const cdp = await page.context().newCDPSession(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const fingers = (spread: number) => [
      { x: cx - spread, y: cy, id: 1 },
      { x: cx + spread, y: cy, id: 2 },
    ];

    const before = await readEditor(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(30) });
    for (let spread = 35; spread <= 120; spread += 5) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: fingers(spread),
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const pinched = await readEditor(page);
    expect(pinched.viewport.scale / before.viewport.scale).toBeCloseTo(4, 1);
    expect(pinched.selection).toBe(0);

    await page.getByRole('button', { name: 'Visa hela planen' }).tap();
    const fitted = await readEditor(page);
    for (const key of ['x', 'y', 'scale'] as const) {
      expect(fitted.viewport[key]).toBeCloseTo(before.viewport[key], 6);
    }
  });

  test('a finger drag that starts just beside a handle moves the handle', async ({ page }) => {
    const { viewport, start, handle, toWorld } = await openWithTestHandle(page);
    const cdp = await page.context().newCDPSession(page);
    // 14 px from the centre of an 8 px dot: outside it, but within a fingertip's reach.
    const finger = { x: handle.x + 14, y: handle.y, id: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger] });
    for (let dy = 5; dy <= 60; dy += 5) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ ...finger, y: finger.y + dy }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    const moved = await readTestHandle(page);
    expect(moved.events[0]).toBe('start:touch');
    expect(moved.events.at(-1)).toBe('end');
    expect(moved.at.y).toBeCloseTo(start.y + toWorld(60), 5);
    expect(await readEditor(page)).toMatchObject({ viewport, selection: 0 });
  });
});
