import { expect, type Page } from '@playwright/test';
import type { View3dItem } from '../src/features/view3d/dev-hook-types';

export type { View3dItem };

export const view3dCanvas = (page: Page) => page.getByTestId('view3d-canvas').locator('canvas');

async function toPage(page: Page, at: { x: number; y: number } | null) {
  const box = await view3dCanvas(page).boundingBox();
  return box && at ? { x: box.x + at.x, y: box.y + at.y } : null;
}

/**
 * Reads `read` until it gives the same non-null value twice in a row, so the view has settled
 * after a resize (a side panel opening or closing) or a camera move.
 */
async function settled<T>(read: () => Promise<T | null>): Promise<T> {
  let last = '';
  const latest: { value: T | null } = { value: null };
  await expect
    .poll(
      async () => {
        latest.value = await read();
        const now = JSON.stringify(latest.value);
        const same = latest.value !== null && now === last;
        last = now;
        return same;
      },
      { intervals: [100] },
    )
    .toBe(true);
  if (latest.value === null) throw new Error('3D view did not settle');
  return latest.value;
}

/** Where an item is drawn in the 3D view, in page pixels; waits until the view has drawn it. */
export async function itemOnPage(page: Page, item: View3dItem): Promise<{ x: number; y: number }> {
  await expect(view3dCanvas(page)).toBeVisible();
  return settled(async () =>
    toPage(page, await page.evaluate((i) => window.__view3d?.screenPosition(i) ?? null, item)),
  );
}

/** The first of `items` that a tap in the 3D view can reach, and where, in page pixels. */
export async function firstOnPage(page: Page, items: readonly View3dItem[]) {
  await expect(view3dCanvas(page)).toBeVisible();
  return settled(async () => {
    const found = await page.evaluate((list) => {
      for (const item of list) {
        const at = window.__view3d?.screenPosition(item);
        if (at) return { item, at };
      }
      return null;
    }, items);
    const at = found && (await toPage(page, found.at));
    return found && at ? { item: found.item, at } : null;
  });
}

/** How many times each floor's merged geometry has been built. */
export const view3dBuilds = (page: Page) => page.evaluate(() => window.__view3d?.builds() ?? {});

/** The selected items the 3D view highlights. */
export const view3dHighlighted = (page: Page) =>
  page.evaluate(() => window.__view3d?.highlighted() ?? []);
