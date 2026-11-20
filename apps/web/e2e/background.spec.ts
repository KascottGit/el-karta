import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  DIMENSION,
  fixture,
  readBackground,
  TRUE_METRES_PER_PIXEL,
  unscaledImageToPage,
} from './background';
import { openNewProjectEditor } from './editor';

const openEditor = (page: Page, run: string) =>
  openNewProjectEditor(page, {
    email: `background-${run}@test.local`,
    project: `E2E-bakgrund ${run}`,
  });

test('on a phone, a plan image is uploaded, scaled with two taps and a typed length, and kept after reload', async ({
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
  await openEditor(page, run);

  await page.getByRole('button', { name: 'Bakgrund', exact: true }).tap();
  await page.getByTestId('background-file').setInputFiles(fixture('plan.png'));
  await expect.poll(async () => (await readBackground(page)).image?.status).toBe('ready');
  const uploaded = await readBackground(page);
  expect(uploaded.background).toMatchObject({ offset: { x: 0, y: 0 }, rotation: 0 });
  expect(uploaded.scale).toBeUndefined();

  await page.getByRole('button', { name: 'Mät skala' }).tap();
  await expect(page.getByText('Tryck på ena änden')).toBeVisible();
  const onScreen = await unscaledImageToPage(page);
  const a = onScreen(DIMENSION.a);
  const b = onScreen(DIMENSION.b);
  await page.touchscreen.tap(a.x, a.y);
  await expect(page.getByText('Tryck på andra änden')).toBeVisible();
  await page.touchscreen.tap(b.x, b.y);

  const length = page.getByLabel('Verklig längd (m)');
  await length.fill('0');
  await page.getByRole('button', { name: 'Sätt skala' }).tap();
  await expect(page.getByText('Ange en längd större än noll')).toBeVisible();
  await length.fill('4,0');
  await page.getByRole('button', { name: 'Sätt skala' }).tap();
  await expect(page.getByText('Skalan är satt.')).toBeVisible();

  const scaled = await readBackground(page);
  expect(scaled.scale?.source).toBe('user');
  const error = Math.abs(scaled.scale!.metresPerPixel - TRUE_METRES_PER_PIXEL);
  expect(error / TRUE_METRES_PER_PIXEL).toBeLessThan(0.01);
  await expect(page.getByTestId('background-scale')).toContainText('1 bildpunkt = 8');

  await expect(page.getByRole('status').filter({ hasText: 'Sparat' })).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await expect.poll(async () => (await readBackground(page)).image?.status).toBe('ready');
  const reloaded = await readBackground(page);
  expect(reloaded.background).toEqual(scaled.background);
  expect(reloaded.scale).toEqual(scaled.scale);
  expect(reloaded.image?.size).toEqual({ width: 800, height: 600 });
});

test('a page picked from a PDF is stored as a tracing-resolution image', async ({ page }) => {
  await openEditor(page, randomUUID().slice(0, 8));

  await page.getByRole('button', { name: 'Bakgrund', exact: true }).click();
  await page.getByTestId('background-file').setInputFiles(fixture('plan.pdf'));
  await expect(page.getByText('PDF:en har 2 sidor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sida 2' }).locator('img')).toBeVisible();
  await page.getByRole('button', { name: 'Sida 2' }).click();

  await expect.poll(async () => (await readBackground(page)).image?.status).toBe('ready');
  const { background, image } = await readBackground(page);
  expect(background?.pdfPage).toBe(2);
  expect(image?.size).toEqual({ width: 4000, height: 3000 });
  await expect(page.getByText('Sida 2 ur PDF:en.')).toBeVisible();
});
