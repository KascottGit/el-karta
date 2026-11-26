import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseFloorRecord } from '@el-karta/core';
import { expect, test } from '@playwright/test';
import { DIMENSION, fixture, readBackground, unscaledImageToPage } from './background';
import { openNewProjectEditor } from './editor';

test('on a phone, the dev build exports the floor for the photo evals and a scaled floor as a full facit', async ({
  browser,
}) => {
  const run = randomUUID().slice(0, 8);
  const page = await (
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
  ).newPage();
  await openNewProjectEditor(page, {
    email: `facit-${run}@test.local`,
    project: `E2E-facit ${run}`,
  });

  // Any floor can be exported for the photo evals, with or without a background.
  const floorButton = page.getByRole('button', { name: 'Exportera våning' });
  await expect(floorButton).toBeEnabled();
  const [floorDownload] = await Promise.all([page.waitForEvent('download'), floorButton.tap()]);
  expect(floorDownload.suggestedFilename()).toBe('plan-1.json');
  const floor = parseFloorRecord(JSON.parse(await readFile(await floorDownload.path(), 'utf8')));
  expect(floor.name).toBe('Plan 1');
  expect(page.url()).toContain(`/projects/${floor.projectId}/floors/${floor.id}`);

  const exportButton = page.getByRole('button', { name: 'Exportera facit' });
  await expect(exportButton).toBeDisabled();

  await page.getByRole('button', { name: 'Bakgrund', exact: true }).tap();
  await page.getByTestId('background-file').setInputFiles(fixture('plan.png'));
  await expect.poll(async () => (await readBackground(page)).image?.status).toBe('ready');
  await page.getByRole('button', { name: 'Mät skala' }).tap();
  const onScreen = await unscaledImageToPage(page);
  const a = onScreen(DIMENSION.a);
  const b = onScreen(DIMENSION.b);
  await page.touchscreen.tap(a.x, a.y);
  await expect(page.getByText('Tryck på andra änden')).toBeVisible();
  await page.touchscreen.tap(b.x, b.y);
  await page.getByLabel('Verklig längd (m)').fill('4');
  await page.getByRole('button', { name: 'Sätt skala' }).tap();
  await expect(page.getByText('Skalan är satt.')).toBeVisible();

  await expect(exportButton).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.tap()]);
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const facit = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    level: string;
    image: { width: number; height: number };
    scale: { metresPerImageWidth: number };
    walls: unknown[];
  };
  expect(facit).toMatchObject({ level: 'full', image: { width: 800, height: 600 }, walls: [] });
  // plan.png is 800 px wide at 8 mm per pixel.
  expect(facit.scale.metresPerImageWidth).toBeCloseTo(6.4, 1);
});
