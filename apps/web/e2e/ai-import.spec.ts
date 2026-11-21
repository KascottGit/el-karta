import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { EDITOR_STORE, readOpenFloor, worldToPage, type Pt } from './app-modules';
import { DIMENSION, fixture, readBackground } from './background';
import { openNewProjectEditor } from './editor';

/*
 * Needs the `ai-pass` function served with the fake provider and this test's reply, which reads
 * fixtures/plan.png as a two-room flat without a printed scale:
 *
 *   pnpm supabase functions serve --env-file apps/web/e2e/fixtures/ai-import.env
 */

interface Floor {
  walls: Record<string, { a: Pt; b: Pt }>;
  rooms: Record<string, { name: string; provenance: { status: string; source?: string } }>;
  scale?: { source: string; metresPerPixel: number };
}
const readFloor = (page: Page) => readOpenFloor<Floor>(page, ['walls', 'rooms', 'scale']);

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

/**
 * Shows the 800 px wide plan image across the top of the canvas, clear of the panel sheet, and
 * returns image pixels to page pixels (the plan is never turned here).
 */
async function imageToPage(page: Page) {
  const { background, scale } = await readBackground(page);
  const k = scale?.metresPerPixel ?? 0.01;
  const box = (await page.getByTestId('floor-editor-canvas').boundingBox())!;
  await page.evaluate(
    async ([url, offset, metres, width]) => {
      const { editorStore } = (await import(/* @vite-ignore */ url)) as {
        editorStore: {
          getState(): { setViewport(v: { x: number; y: number; scale: number }): void };
        };
      };
      const scale = (width * 0.9) / metres;
      editorStore
        .getState()
        .setViewport({ x: width * 0.05 - offset.x * scale, y: 10 - offset.y * scale, scale });
    },
    [EDITOR_STORE, background!.offset, 800 * k, box.width] as const,
  );
  const toPage = await worldToPage(page);
  return (px: Pt) =>
    toPage({ x: background!.offset.x + px.x * k, y: background!.offset.y + px.y * k });
}

/** Signs in as a new user, uploads the plan as the floor's background and starts the import. */
async function importPlan(page: Page, run: string) {
  await openNewProjectEditor(page, {
    email: `ai-import-${run}@test.local`,
    project: `E2E-AI ${run}`,
  });
  await page.getByRole('button', { name: 'Bakgrund', exact: true }).tap();
  await page.getByTestId('background-file').setInputFiles(fixture('plan.png'));
  await expect.poll(async () => (await readBackground(page)).image?.status).toBe('ready');
  await page.getByRole('button', { name: 'Tolka planritning med AI' }).tap();
  const panel = page.getByRole('region', { name: 'Tolka planritning med AI' });
  await expect(panel.getByText('Vet du ett mått?')).toBeVisible();
  return panel;
}

/** Measures the printed 4 m dimension line with the scale tool, as `length` metres. */
async function measure(page: Page, length: string) {
  await expect(page.getByText('Tryck på ena änden')).toBeVisible();
  const onScreen = await imageToPage(page);
  const a = onScreen(DIMENSION.a);
  const b = onScreen(DIMENSION.b);
  await page.touchscreen.tap(a.x, a.y);
  await expect(page.getByText('Tryck på andra änden')).toBeVisible();
  await page.touchscreen.tap(b.x, b.y);
  await page.getByLabel('Verklig längd (m)').fill(length);
  await page.getByRole('button', { name: 'Sätt skala' }).tap();
}

test.describe('importing a floor plan with AI on a phone', () => {
  test.use(phone);

  test('"Mät ett mått": import, accept some, reject some, and only the accepted ones remain after reload', async ({
    page,
  }) => {
    const panel = await importPlan(page, randomUUID().slice(0, 8));
    await panel.getByRole('button', { name: 'Mät ett mått' }).tap();
    await measure(page, '4,0');

    const review = page.getByRole('region', { name: 'Förslag', exact: true });
    await expect(review.getByText(/förslag att granska/).first()).toBeVisible();
    await expect(panel).toBeHidden();
    const before = await readFloor(page);
    expect(before.scale).toMatchObject({ source: 'user' });
    expect(Object.keys(before.walls)).toEqual([]);

    await review.getByText('Rum (2)').tap();
    await review.getByRole('button', { name: /^Godkänn Sovrum/ }).tap();
    await review.getByRole('button', { name: /^Avvisa Kök/ }).tap();
    await expect(review.getByRole('button', { name: /^Avvisa Kök/ })).toBeHidden();
    await expect(review.getByRole('button', { name: /^Godkänn Sovrum/ })).toBeHidden();
    const accepted = await readFloor(page);
    expect(Object.values(accepted.rooms).map((r) => [r.name, r.provenance.status])).toEqual([
      ['Sovrum', 'confirmed'],
    ]);
    // Five walls and a door are still pending.
    const pending = 6;
    await expect(review.getByText(`${pending} förslag att granska.`)).toBeVisible();

    await expect(page.getByRole('status').filter({ hasText: 'Sparat' })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();
    await expect.poll(async () => (await readBackground(page)).image?.status).toBe('ready');
    const reloaded = await readFloor(page);
    expect(Object.values(reloaded.rooms).map((r) => r.name)).toEqual(['Sovrum']);
    expect(reloaded.scale).toEqual(before.scale);

    const prompt = page.getByRole('region', { name: 'Granska förslag' });
    await prompt.getByRole('button', { name: 'Granska', exact: true }).tap();
    await expect(review.getByText(`${pending} förslag att granska.`)).toBeVisible();
    await expect(review.getByText(/^Rum/)).toBeHidden();
  });

  test('"Uppskatta åt mig": an estimated scale is flagged on the floor until someone measures, and the drawing follows', async ({
    page,
  }) => {
    const panel = await importPlan(page, randomUUID().slice(0, 8));
    await panel.getByRole('button', { name: 'Uppskatta åt mig' }).tap();

    const review = page.getByRole('region', { name: 'Förslag', exact: true });
    await expect(review.getByText(/Skala: 1 bildpunkt = 8 mm \(uppskattad\)/)).toBeVisible();
    await review.getByRole('button', { name: /^Godkänn alla/ }).tap();
    await expect(review.getByText('Inga förslag att granska.')).toBeVisible();
    const estimated = await readFloor(page);
    expect(estimated.scale?.source).toBe('ai_estimate');
    expect(estimated.scale!.metresPerPixel).toBeCloseTo(0.008, 4);
    expect(Object.keys(estimated.walls).length).toBeGreaterThanOrEqual(5);

    const notice = page.getByRole('status', { name: 'Uppskattad skala – kontrollera ett mått' });
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Mät skala' }).tap();
    // The dimension line is really 5 m, so the plan is 25 % larger than estimated.
    await measure(page, '5');
    await expect(page.getByText('Skalan är satt.')).toBeVisible();
    const rescale = page.getByRole('group', { name: 'Skala om ritningen' });
    await rescale.getByRole('button', { name: 'Skala om', exact: true }).tap();
    await expect(rescale).toBeHidden();

    const measured = await readFloor(page);
    expect(measured.scale?.source).toBe('user');
    const length = (w: { a: Pt; b: Pt }) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    for (const [id, wall] of Object.entries(measured.walls))
      expect(length(wall) / length(estimated.walls[id]!)).toBeCloseTo(1.25, 1);
    await page.getByRole('button', { name: 'Markera', exact: true }).tap();
    await expect(notice).toBeHidden();
  });
});
