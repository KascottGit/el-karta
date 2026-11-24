import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { EDITOR_STORE, MODEL_STORE, readSelection, worldToPage, type Pt } from './app-modules';
import { fixture } from './background';
import { openNewProjectEditor } from './editor';
import { itemOnPage, view3dCanvas } from './view3d';

interface Seeded {
  floorId: string;
  roomId: string;
  topWallId: string;
}

/** Draws a 5 × 4 m kitchen with its four walls on the open floor. */
const seedKitchen = (page: Page) =>
  page.evaluate(
    async ([modelUrl, editorUrl]) => {
      type Draft = { floors: Record<string, { data: Record<string, Record<string, unknown>> }> };
      const { modelStore } = (await import(/* @vite-ignore */ modelUrl!)) as {
        modelStore: { getState(): { apply(edit: (draft: Draft) => void): void } };
      };
      const { editorStore } = (await import(/* @vite-ignore */ editorUrl!)) as {
        editorStore: { getState(): { floorId: string } };
      };
      const floorId = editorStore.getState().floorId;
      const corners = [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 4 },
        { x: 0, y: 4 },
      ];
      const walls = corners.map((a, i) => ({
        id: crypto.randomUUID(),
        a,
        b: corners[(i + 1) % 4]!,
        thickness: 0.2,
        provenance: { status: 'manual' },
      }));
      const room = {
        id: crypto.randomUUID(),
        name: 'Kök',
        type: 'kitchen',
        polygon: corners,
        provenance: { status: 'manual' },
      };
      modelStore.getState().apply((draft) => {
        const data = draft.floors[floorId]!.data;
        for (const wall of walls) data['walls']![wall.id] = wall;
        data['rooms']![room.id] = room;
      });
      return { floorId, roomId: room.id, topWallId: walls[0]!.id };
    },
    [MODEL_STORE, EDITOR_STORE],
  ) as Promise<Seeded>;

/** Shows the plan at 60 px per metre with `at` a fifth of the way down the canvas, clear of the sheet. */
const viewAt = (page: Page, at: Pt) =>
  page.evaluate(
    async ([url, point]) => {
      const { editorStore } = (await import(/* @vite-ignore */ url)) as {
        editorStore: {
          getState(): {
            size: { width: number };
            setViewport(v: { x: number; y: number; scale: number }): void;
          };
        };
      };
      const editor = editorStore.getState();
      editor.setViewport({
        x: editor.size.width / 2 - point.x * 60,
        y: 60 - point.y * 60,
        scale: 60,
      });
    },
    [EDITOR_STORE, at] as const,
  );

const tapButton = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true }).tap();

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a photo of a wall picked in 2D is listed under that wall, upright and without EXIF, in 3D too, and can be deleted', async ({
    page,
  }) => {
    const run = randomUUID().slice(0, 8);
    await openNewProjectEditor(page, {
      email: `photos-${run}@test.local`,
      project: `E2E-foton ${run}`,
    });
    const seeded = await seedKitchen(page);
    await viewAt(page, { x: 2.5, y: 0 });

    // In 2D: the photo tool, then a tap on the kitchen's top wall.
    await tapButton(page, 'Foton');
    const panel = page.getByRole('region', { name: 'Foton', exact: true });
    await expect(panel.getByText('Tryck på ett rum eller en vägg')).toBeVisible();
    const wallAt = (await worldToPage(page))({ x: 2.5, y: 0 });
    await page.touchscreen.tap(wallAt.x, wallAt.y);
    expect(await readSelection(page)).toEqual([{ collection: 'walls', id: seeded.topWallId }]);
    await expect(panel.getByText('Vald vägg i Kök')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Ta foto' })).toBeVisible();
    await expect(panel.getByTestId('photo-camera')).toHaveAttribute('capture', 'environment');

    await panel.getByTestId('photo-file').setInputFiles(fixture('photo-rotated.jpg'));
    const ofWall = panel.getByRole('region', { name: 'Vald vägg', exact: true });
    const thumbnail = ofWall.getByRole('button', { name: 'Visa foto 1' });
    await expect(thumbnail).toBeVisible({ timeout: 15_000 });
    await expect(thumbnail.locator('img')).toHaveJSProperty('complete', true);

    // Full size: turned upright by its EXIF orientation, and stored without EXIF.
    await thumbnail.tap();
    const viewer = page.getByRole('dialog', { name: 'Foto' });
    const image = viewer.getByRole('img', { name: 'Foto' });
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]))
      .toEqual([200, 400]);
    const stored = await image.evaluate(async (img: HTMLImageElement) => {
      const bytes = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
      return {
        jpeg: bytes[0] === 0xff && bytes[1] === 0xd8,
        text: new TextDecoder('latin1').decode(bytes),
      };
    });
    expect(stored.jpeg).toBe(true);
    expect(stored.text).not.toContain('Exif');
    await viewer.getByRole('button', { name: 'Stäng' }).tap();
    await expect(viewer).toBeHidden();

    // In 3D: with nothing selected the panel asks for a target; a tap on the same wall lists the photo.
    await tapButton(page, '3D');
    await expect(view3dCanvas(page)).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await readSelection(page)).toEqual([]);
    await expect(panel.getByText('Tryck på ett rum eller en vägg')).toBeVisible();
    const at3d = await itemOnPage(page, {
      floorId: seeded.floorId,
      collection: 'walls',
      id: seeded.topWallId,
    });
    await page.touchscreen.tap(at3d.x, at3d.y);
    expect(await readSelection(page)).toEqual([{ collection: 'walls', id: seeded.topWallId }]);
    await expect(ofWall.getByRole('button', { name: 'Visa foto 1' })).toBeVisible();

    // Delete, after confirming.
    await ofWall.getByRole('button', { name: 'Visa foto 1' }).tap();
    page.once('dialog', (dialog) => void dialog.accept());
    await viewer.getByRole('button', { name: 'Ta bort foto' }).tap();
    await expect(viewer).toBeHidden();
    await expect(ofWall.getByText('Inga foton än.')).toBeVisible();
  });
});
