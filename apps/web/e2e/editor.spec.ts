import { expect, test } from '@playwright/test';

test('the dev route opens the busiest floor of a synthetic project in the editor', async ({
  page,
}) => {
  await page.goto('/dev/synthetic/large');
  await expect(page.getByRole('heading', { name: /^Plan \d+$/ })).toBeVisible();
  await expect(page.getByTestId('floor-editor-canvas')).toBeVisible();
});
