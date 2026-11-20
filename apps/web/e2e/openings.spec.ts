import { expect, test, type Page } from '@playwright/test';
import { EDITOR_STORE, readEditor } from './app-modules';

const MODEL_STORE = '/src/model/store.ts';

interface Pt {
  x: number;
  y: number;
}

interface OpeningSnapshot {
  id: string;
  wallId: string;
  kind: string;
  offset: number;
  width: number;
  hinge?: string;
}

/** The walls and openings of the floor open in the editor. */
const readFloor = (page: Page) =>
  page.evaluate(
    async ([modelUrl, editorUrl]) => {
      const { modelStore } = (await import(/* @vite-ignore */ modelUrl!)) as {
        modelStore: {
          getState(): {
            model: {
              floors: Record<
                string,
                {
                  data: {
                    walls: Record<string, { id: string; a: Pt; b: Pt }>;
                    openings: Record<string, OpeningSnapshot>;
                  };
                }
              >;
            };
          };
        };
      };
      const { editorStore } = (await import(/* @vite-ignore */ editorUrl!)) as {
        editorStore: { getState(): { floorId: string } };
      };
      const { data } = modelStore.getState().model.floors[editorStore.getState().floorId]!;
      return { walls: Object.values(data.walls), openings: Object.values(data.openings) };
    },
    [MODEL_STORE, EDITOR_STORE],
  );

async function openSmall(page: Page) {
  await page.goto('/dev/synthetic/small');
  const canvas = page.getByTestId('floor-editor-canvas');
  await expect(canvas.locator('canvas').first()).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const { viewport } = await readEditor(page);
  return (world: Pt) => ({
    x: box.x + world.x * viewport.scale + viewport.x,
    y: box.y + world.y * viewport.scale + viewport.y,
  });
}

test('placing a door and a window on a new wall, sliding the door and undoing it', async ({
  page,
}) => {
  const toPage = await openSmall(page);
  const before = await readFloor(page);

  // A three-metre wall inside the first room of the small villa.
  await page.keyboard.press('w');
  const a = toPage({ x: 1, y: 1 });
  const b = toPage({ x: 4, y: 1 });
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.dblclick(b.x, b.y);
  const known = new Set(before.walls.map((w) => w.id));
  const wall = (await readFloor(page)).walls.find((w) => !known.has(w.id))!;
  expect(wall).toBeDefined();

  await page.keyboard.press('d');
  const doorAt = toPage({ x: 1.5, y: 1 });
  await page.mouse.move(doorAt.x, doorAt.y, { steps: 2 });
  await page.mouse.click(doorAt.x, doorAt.y);
  await page.keyboard.press('n');
  const windowAt = toPage({ x: 3.3, y: 1 });
  await page.mouse.click(windowAt.x, windowAt.y);

  const placed = (await readFloor(page)).openings.filter((o) => o.wallId === wall.id);
  const door = placed.find((o) => o.kind === 'door')!;
  const window = placed.find((o) => o.kind === 'window')!;
  expect(door.offset).toBeCloseTo(1.5 - wall.a.x - 0.45, 1);
  expect(window.offset).toBeCloseTo(3.3 - wall.a.x - 0.6, 1);

  // Slide the door half a metre, then far into the window: it stops beside it.
  const doorById = async () => (await readFloor(page)).openings.find((o) => o.id === door.id)!;
  await page.mouse.move(doorAt.x, doorAt.y);
  await page.mouse.down();
  const half = toPage({ x: 2, y: 1.3 });
  await page.mouse.move(half.x, half.y, { steps: 8 });
  await page.mouse.up();
  expect((await doorById()).offset).toBeCloseTo(door.offset + 0.5, 1);

  await page.keyboard.press('Control+z');
  expect((await doorById()).offset).toBeCloseTo(door.offset, 5);
  await page.keyboard.press('Control+Shift+z');
  expect((await doorById()).offset).toBeCloseTo(door.offset + 0.5, 1);

  const moved = toPage({ x: 2, y: 1 });
  await page.mouse.move(moved.x, moved.y);
  await page.mouse.down();
  const far = toPage({ x: 3.8, y: 1 });
  await page.mouse.move(far.x, far.y, { steps: 8 });
  await page.mouse.up();
  expect((await doorById()).offset).toBeCloseTo(window.offset - door.width, 5);

  // Select the door and flip its hinge in the side panel.
  await page.keyboard.press('v');
  const now = await doorById();
  const doorCentre = toPage({ x: wall.a.x + now.offset + now.width / 2, y: 1 });
  await page.mouse.click(doorCentre.x, doorCentre.y);
  const panel = page.getByRole('region', { name: 'Dörr', exact: true });
  await expect(panel).toBeVisible();
  const hinge = now.hinge;
  await panel.getByRole('button', { name: 'Byt gångjärnssida' }).click();
  expect((await doorById()).hinge).not.toBe(hinge);
});
