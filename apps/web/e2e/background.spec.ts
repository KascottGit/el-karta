import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { readEditor } from './app-modules';
import { signIn } from './auth';

const MODEL_STORE = '/src/model/store.ts';
const IMAGES = '/src/features/floorplan/background/images.ts';
const fixture = (name: string) => new URL(`fixtures/${name}`, import.meta.url).pathname;

// plan.png is drawn at 8 mm per pixel: its dimension line runs from (100, 550) to (600, 550), 4 m.
const DIMENSION = { a: { x: 100, y: 550 }, b: { x: 600, y: 550 }, metres: 4 };
const TRUE_METRES_PER_PIXEL = 0.008;

interface Pt {
  x: number;
  y: number;
}

interface FloorBackground {
  background?: { attachmentId: string; pdfPage?: number; offset: Pt; rotation: number };
  scale?: { source: string; metresPerPixel: number };
}

/** The open floor's background and scale, and the loaded image's size, read from the app's stores. */
const readBackground = (page: Page) =>
  page.evaluate(
    async ([modelUrl, imagesUrl]) => {
      const { modelStore } = (await import(/* @vite-ignore */ modelUrl!)) as {
        modelStore: {
          getState(): { model: { floors: Record<string, { data: FloorBackground }> } | null };
        };
      };
      const { imageStore } = (await import(/* @vite-ignore */ imagesUrl!)) as {
        imageStore: {
          getState(): Record<string, { status: string; size?: { width: number; height: number } }>;
        };
      };
      const floorId = /floors\/([^/?]+)/.exec(location.pathname)?.[1] ?? '';
      const data = modelStore.getState().model?.floors[floorId]?.data;
      const image = data?.background && imageStore.getState()[data.background.attachmentId];
      return { background: data?.background, scale: data?.scale, image };
    },
    [MODEL_STORE, IMAGES],
  );

async function openNewProjectEditor(page: Page, run: string) {
  await signIn(page, `background-${run}@test.local`);
  await page.getByLabel('Namn').fill(`E2E-bakgrund ${run}`);
  await page.getByRole('button', { name: 'Skapa projekt' }).click();
  await page.getByRole('link', { name: /Plan 1/ }).click();
  await expect(page.getByTestId('floor-editor-canvas').locator('canvas').first()).toBeVisible();
}

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
  await openNewProjectEditor(page, run);

  await page.getByRole('button', { name: 'Bakgrund', exact: true }).tap();
  await page.getByTestId('background-file').setInputFiles(fixture('plan.png'));
  await expect.poll(async () => (await readBackground(page)).image?.status).toBe('ready');
  const uploaded = await readBackground(page);
  expect(uploaded.background).toMatchObject({ offset: { x: 0, y: 0 }, rotation: 0 });
  expect(uploaded.scale).toBeUndefined();

  await page.getByRole('button', { name: 'Mät skala' }).tap();
  await expect(page.getByText('Tryck på ena änden')).toBeVisible();
  const box = (await page.getByTestId('floor-editor-canvas').boundingBox())!;
  const { viewport } = await readEditor(page);
  // No scale yet, so the image is shown at the default 1 cm per pixel from the plan origin.
  const onScreen = (px: Pt) => ({
    x: box.x + px.x * 0.01 * viewport.scale + viewport.x,
    y: box.y + px.y * 0.01 * viewport.scale + viewport.y,
  });
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
  await openNewProjectEditor(page, randomUUID().slice(0, 8));

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
