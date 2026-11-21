import { expect, test, type Page } from '@playwright/test';
import {
  EDITOR_STORE,
  MODEL_STORE,
  readEditor,
  readOpenFloor,
  readSelection,
  type Pt,
} from './app-modules';
import { openSynthetic } from './editor';

const SUGGESTIONS_STORE = '/src/features/suggestions/suggestions-store.ts';

interface Floor {
  walls: Record<string, unknown>;
  rooms: Record<string, { name: string; provenance: { status: string } }>;
  scale?: { metresPerPixel: number };
  height: number;
}
const readFloor = (page: Page) => readOpenFloor<Floor>(page, ['walls', 'rooms', 'scale', 'height']);

const history = (page: Page) =>
  page.evaluate(async (url) => {
    const { modelStore } = (await import(/* @vite-ignore */ url)) as {
      modelStore: { getState(): { past: unknown[] } };
    };
    return modelStore.getState().past.length;
  }, MODEL_STORE);

/** The demo room's corners, from the ghosts the suggestions layer drew. */
const demoRoom = (page: Page) =>
  page.evaluate(async (url) => {
    const { suggestionsStore } = (await import(/* @vite-ignore */ url)) as {
      suggestionsStore: {
        getState(): {
          ghosts: { value: Record<string, { shape: { role: string; polygon?: Pt[] } }> } | null;
        };
      };
    };
    const ghosts = Object.values(suggestionsStore.getState().ghosts?.value ?? {});
    return ghosts.find((g) => g.shape.role === 'area')!.shape.polygon!;
  }, SUGGESTIONS_STORE);

/** Moves the view so that `world` is in the middle of the canvas's top third, clear of the panel sheet. */
async function showAtTop(page: Page, world: Pt) {
  const box = (await page.getByTestId('floor-editor-canvas').boundingBox())!;
  await page.evaluate(
    async ([url, at, width, height]) => {
      const { editorStore } = (await import(/* @vite-ignore */ url)) as {
        editorStore: {
          getState(): {
            setViewport(v: { x: number; y: number; scale: number }): void;
          };
        };
      };
      const scale = 40;
      editorStore
        .getState()
        .setViewport({ x: width / 2 - at.x * scale, y: height / 6 - at.y * scale, scale });
    },
    [EDITOR_STORE, world, box.width, box.height] as const,
  );
  return { x: box.x + box.width / 2, y: box.y + box.height / 6 };
}

/** Opens the demo floor and goes to the review from the prompt the select tool shows. */
async function openReview(page: Page) {
  await openSynthetic(page, 'small', '?suggestions');
  const prompt = page.getByRole('region', { name: 'Granska förslag' });
  await expect(prompt.getByText('9 förslag att granska.')).toBeVisible();
  await prompt.getByRole('button', { name: 'Granska', exact: true }).tap();
  await expect(prompt).toBeHidden();
  const panel = page.getByRole('region', { name: 'Förslag', exact: true });
  await expect(panel.getByText('9 förslag att granska.')).toBeVisible();
  return panel;
}

test.describe('reviewing suggestions on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('tapping a ghost selects it, and "Godkänn och redigera" adds it in one step and selects it', async ({
    page,
  }) => {
    const panel = await openReview(page);
    await expect(panel.getByText('Skala: 1 bildpunkt = 12 mm (från måttangivelse)')).toBeVisible();
    await expect(panel.getByText('Våningshöjd 2,55 m')).toBeVisible();
    const before = await readFloor(page);
    const steps = await history(page);

    const corners = await demoRoom(page);
    const centre = {
      x: corners.reduce((s, p) => s + p.x, 0) / corners.length,
      y: corners.reduce((s, p) => s + p.y, 0) / corners.length,
    };
    const spot = await showAtTop(page, centre);
    await page.touchscreen.tap(spot.x, spot.y);
    const selected = panel.getByRole('group', { name: 'Markerat förslag' });
    await expect(selected.getByText('Sovrum')).toBeVisible();
    await expect(selected.getByText('Ritningen anger 11 m², men rummet blir 12 m².')).toBeVisible();

    await selected.getByRole('button', { name: 'Godkänn och redigera' }).tap();
    // The room was measured with the suggested scale, so accepting it takes the scale too.
    const confirm = panel.getByRole('alertdialog');
    await expect(
      confirm.getByText('Godkänns tillsammans med 1 förslag det bygger på.'),
    ).toBeVisible();
    await confirm.getByRole('button', { name: 'Godkänn 2 förslag' }).tap();

    await expect(page.getByRole('region', { name: 'Förslag', exact: true })).toBeHidden();
    const after = await readFloor(page);
    const added = Object.entries(after.rooms).filter(([id]) => !(id in before.rooms));
    expect(added.map(([, room]) => [room.name, room.provenance.status])).toEqual([
      ['Sovrum', 'confirmed'],
    ]);
    expect(after.scale?.metresPerPixel).toBe(0.012);
    expect(await history(page)).toBe(steps + 1);
    expect(await readSelection(page)).toEqual([{ collection: 'rooms', id: added[0]![0] }]);
    expect((await readEditor(page)).tool).toBe('select');
    const prompt = page.getByRole('region', { name: 'Granska förslag' });
    await expect(prompt.getByText('7 förslag att granska.')).toBeVisible();

    // Undo takes the whole accept back, and the suggestions with it: their ghosts return.
    await page.getByRole('button', { name: 'Ångra' }).tap();
    const undone = await readFloor(page);
    expect(Object.keys(undone.rooms)).toEqual(Object.keys(before.rooms));
    expect(undone.scale).toEqual(before.scale);
    await expect(prompt.getByText('9 förslag att granska.')).toBeVisible();
    expect(await demoRoom(page)).toEqual(corners);

    // Redo accepts them again.
    await page.getByRole('button', { name: 'Gör om' }).tap();
    await expect(prompt.getByText('7 förslag att granska.')).toBeVisible();
  });

  test('rejecting the scale asks first and rejects what was measured with it, leaving the floor as it was', async ({
    page,
  }) => {
    const panel = await openReview(page);
    const before = await readFloor(page);

    await panel.getByRole('button', { name: /^Avvisa Skala/ }).tap();
    const confirm = panel.getByRole('alertdialog');
    await expect(
      confirm.getByText('7 andra förslag bygger på det här och avvisas också.'),
    ).toBeVisible();
    await confirm.getByRole('button', { name: 'Avvisa 8 förslag' }).tap();

    await expect(panel.getByText('1 förslag att granska.')).toBeVisible();
    await expect(panel.getByText('Våningshöjd 2,55 m')).toBeVisible();
    expect(await readFloor(page)).toEqual(before);

    await panel.getByRole('button', { name: 'Avvisa alla (1)' }).tap();
    await expect(panel.getByText('Inga förslag att granska.')).toBeVisible();
    expect(await readFloor(page)).toEqual(before);
  });

  test('"Godkänn säkra" accepts only what reaches the threshold, with what it requires', async ({
    page,
  }) => {
    const panel = await openReview(page);
    const before = await readFloor(page);
    const steps = await history(page);

    await panel.getByRole('button', { name: 'Godkänn säkra (5)' }).tap();

    await expect(panel.getByText('4 förslag att granska.')).toBeVisible();
    const after = await readFloor(page);
    expect(Object.keys(after.walls).length - Object.keys(before.walls).length).toBe(2);
    expect(Object.keys(after.rooms).length - Object.keys(before.rooms).length).toBe(1);
    expect(after.height).toBe(2.55);
    expect(await history(page)).toBe(steps + 1);
  });
});
