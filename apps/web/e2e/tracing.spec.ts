import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { readOpenFloor, worldToPage, type Pt } from './app-modules';
import {
  DIMENSION,
  fixture,
  readBackground,
  TRUE_METRES_PER_PIXEL,
  unscaledImageToPage,
} from './background';
import { openNewProjectEditor } from './editor';

interface TracedFloor {
  walls: Record<string, { id: string; a: Pt; b: Pt }>;
  openings: Record<string, { wallId: string; kind: string }>;
  rooms: Record<string, { name: string; type: string; polygon: Pt[] }>;
}

const readTraced = async (page: Page) => {
  const floor = await readOpenFloor<TracedFloor>(page, ['walls', 'openings', 'rooms']);
  return {
    walls: Object.values(floor.walls),
    openings: Object.values(floor.openings),
    rooms: Object.values(floor.rooms),
  };
};

// A 4 × 3 m room inside the 6.4 × 4.8 m plan image, once it is scaled.
const CORNERS = [
  { x: 1, y: 1 },
  { x: 5, y: 1 },
  { x: 5, y: 4 },
  { x: 1, y: 4 },
];

const click = (page: Page, at: Pt) => page.mouse.click(at.x, at.y);

async function waitUntilSaved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'Sparat' })).toBeVisible({
    timeout: 15_000,
  });
}

test('tracing a floor from a plan image: everything is kept after a reload', async ({ page }) => {
  const run = randomUUID().slice(0, 8);
  await openNewProjectEditor(page, {
    email: `tracing-${run}@test.local`,
    project: `E2E-ritning ${run}`,
  });
  const floorUrl = page.url();

  await page.getByRole('button', { name: 'Bakgrund', exact: true }).click();
  await page.getByTestId('background-file').setInputFiles(fixture('plan.png'));
  await expect.poll(async () => (await readBackground(page)).image?.status).toBe('ready');

  await page.getByRole('button', { name: 'Mät skala' }).click();
  const imageToPage = await unscaledImageToPage(page);
  await click(page, imageToPage(DIMENSION.a));
  await expect(page.getByText('Tryck på andra änden')).toBeVisible();
  await click(page, imageToPage(DIMENSION.b));
  await page.getByLabel('Verklig längd (m)').fill('4');
  await page.getByRole('button', { name: 'Sätt skala' }).click();
  await expect(page.getByText('Skalan är satt.')).toBeVisible();
  const { background, scale } = await readBackground(page);
  expect(scale?.source).toBe('user');
  expect(Math.abs(scale!.metresPerPixel - TRUE_METRES_PER_PIXEL)).toBeLessThan(
    TRUE_METRES_PER_PIXEL / 100,
  );

  const toPage = await worldToPage(page);
  const canvas = (await page.getByTestId('floor-editor-canvas').boundingBox())!;
  for (const corner of CORNERS) {
    const at = toPage(corner);
    expect(at.x).toBeGreaterThan(canvas.x);
    expect(at.x).toBeLessThan(canvas.x + canvas.width);
    expect(at.y).toBeGreaterThan(canvas.y);
    expect(at.y).toBeLessThan(canvas.y + canvas.height);
  }

  // A tap on the first corner closes the loop and finishes.
  await page.getByRole('button', { name: 'Vägg', exact: true }).click();
  for (const corner of [...CORNERS, CORNERS[0]!]) {
    const at = toPage(corner);
    await page.mouse.move(at.x, at.y, { steps: 4 });
    await page.mouse.click(at.x, at.y);
  }
  await expect.poll(async () => (await readTraced(page)).walls.length).toBe(4);

  await page.getByRole('button', { name: 'Dörr', exact: true }).click();
  const doorAt = toPage({ x: 3, y: 1 });
  await page.mouse.move(doorAt.x, doorAt.y, { steps: 2 });
  await click(page, doorAt);
  await page.getByRole('button', { name: 'Fönster', exact: true }).click();
  const windowAt = toPage({ x: 5, y: 2.5 });
  await page.mouse.move(windowAt.x, windowAt.y, { steps: 2 });
  await click(page, windowAt);
  await expect.poll(async () => (await readTraced(page)).openings.length).toBe(2);

  await page.getByRole('button', { name: 'Fyll rum mellan väggar' }).click();
  await click(page, toPage({ x: 3, y: 2.5 }));
  const roomPanel = page.getByRole('region', { name: 'Rum', exact: true });
  await expect(roomPanel).toBeVisible();
  const name = roomPanel.getByLabel('Namn');
  await name.fill('Kök');
  await name.press('Enter');
  await roomPanel.getByLabel('Typ av rum').selectOption({ label: 'Kök' });
  await expect
    .poll(async () => (await readTraced(page)).rooms.map((r) => [r.name, r.type]))
    .toEqual([['Kök', 'kitchen']]);
  const traced = await readTraced(page);
  expect(traced.rooms[0]!.polygon).toHaveLength(4);
  expect(new Set(traced.openings.map((o) => o.wallId)).size).toBe(2);

  // Floors are added on the project page; the editor's floor switcher then appears.
  await page.getByRole('link', { name: '← Till projektet' }).click();
  await page.getByRole('button', { name: 'Lägg till våning' }).click();
  await expect(page.getByRole('link', { name: /Plan 2/ })).toBeVisible();
  await page.getByRole('link', { name: /Plan 1/ }).click();
  await expect(page).toHaveURL(floorUrl);
  const floorSwitcher = page.getByLabel('Våning', { exact: true });
  await floorSwitcher.selectOption({ label: 'Plan 2' });
  await expect(page.getByRole('heading', { name: 'Plan 2', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(floorUrl);

  await waitUntilSaved(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Plan 2', exact: true })).toBeVisible();
  await expect(floorSwitcher.locator('option')).toHaveText(['Plan 2', 'Plan 1']);
  await floorSwitcher.selectOption({ label: 'Plan 1' });
  await expect(page.getByRole('heading', { name: 'Plan 1', exact: true })).toBeVisible();

  await expect.poll(async () => (await readBackground(page)).image?.status).toBe('ready');
  const reloaded = await readBackground(page);
  expect(reloaded.background).toEqual(background);
  expect(reloaded.scale).toEqual(scale);
  await page.getByRole('button', { name: 'Bakgrund', exact: true }).click();
  await expect(page.getByTestId('background-scale')).toContainText('1 bildpunkt = 8');

  const saved = await readTraced(page);
  expect(saved.walls).toHaveLength(4);
  expect(saved.walls).toEqual(expect.arrayContaining(traced.walls));
  expect(saved.openings.map((o) => o.kind).sort()).toEqual(['door', 'window']);
  expect(saved.rooms).toEqual(traced.rooms);

  await page.getByRole('button', { name: 'Markera', exact: true }).click();
  await click(page, (await worldToPage(page))({ x: 3, y: 2.5 }));
  await expect(roomPanel.getByLabel('Namn')).toHaveValue('Kök');
  await expect(roomPanel.getByLabel('Typ av rum')).toHaveValue('kitchen');
});
