import { expect, type Page } from '@playwright/test';
import type { View3dItem } from '../src/features/view3d/dev-hook-types';

export const view3dCanvas = (page: Page) => page.getByTestId('view3d-canvas').locator('canvas');

const screenPosition = (page: Page, item: View3dItem) =>
  page.evaluate((i) => window.__view3d?.screenPosition(i) ?? null, item);

/** Where an item is drawn in the 3D view, in page pixels; waits until the view has drawn it. */
export async function itemOnPage(page: Page, item: View3dItem): Promise<{ x: number; y: number }> {
  const canvas = view3dCanvas(page);
  await expect(canvas).toBeVisible();
  await expect.poll(() => screenPosition(page, item)).not.toBeNull();
  const at = await screenPosition(page, item);
  const box = await canvas.boundingBox();
  if (!box || !at) throw new Error('3D canvas or item not found');
  return { x: box.x + at.x, y: box.y + at.y };
}

/** How many times each floor's merged geometry has been built. */
export const view3dBuilds = (page: Page) => page.evaluate(() => window.__view3d?.builds() ?? {});
