import { expect, test, type Locator, type Page } from '@playwright/test';

/** Konva draws on the next animation frame, so wait until two screenshots agree. */
async function settledScreenshot(locator: Locator) {
  let previous = await locator.screenshot();
  for (;;) {
    const next = await locator.screenshot();
    if (Buffer.compare(previous, next) === 0) return next;
    previous = next;
  }
}

async function openSmall(page: Page) {
  await page.goto('/dev/synthetic/small');
  const canvas = page.getByTestId('floor-editor-canvas');
  await expect(canvas.locator('canvas').first()).toBeVisible();
  return { canvas, box: (await canvas.boundingBox())! };
}

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
    const { canvas, box } = await openSmall(page);
    const cdp = await page.context().newCDPSession(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const fingers = (spread: number) => [
      { x: cx - spread, y: cy, id: 1 },
      { x: cx + spread, y: cy, id: 2 },
    ];

    const before = await settledScreenshot(canvas);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(30) });
    for (let spread = 35; spread <= 120; spread += 5) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: fingers(spread),
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(Buffer.compare(before, await settledScreenshot(canvas))).not.toBe(0);

    await page.getByRole('button', { name: 'Visa hela planen' }).tap();
    expect(Buffer.compare(before, await settledScreenshot(canvas))).toBe(0);
  });
});
