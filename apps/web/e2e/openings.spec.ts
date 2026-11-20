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

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a finger tap on a wall places a door there, and tapping it shows its panel', async ({
    page,
  }) => {
    const toPage = await openSmall(page);
    const canvas = (await page.getByTestId('floor-editor-canvas').boundingBox())!;
    const { walls, openings } = await readFloor(page);

    // A spot on a wall in the top of the view, clear of the side panel sheet, where a door fits
    // without being nudged.
    const spot = walls
      .flatMap((wall) => {
        const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
        return [0.25, 0.5, 0.75].map((f) => {
          const t = f * length;
          const at = {
            x: wall.a.x + ((wall.b.x - wall.a.x) * t) / length,
            y: wall.a.y + ((wall.b.y - wall.a.y) * t) / length,
          };
          return { wall, t, length, screen: toPage(at) };
        });
      })
      .find(
        ({ wall, t, length, screen }) =>
          t >= 0.6 &&
          t <= length - 0.6 &&
          screen.x > canvas.x + 20 &&
          screen.x < canvas.x + canvas.width - 20 &&
          screen.y > canvas.y + 20 &&
          screen.y < canvas.y + canvas.height * 0.4 &&
          openings.every(
            (o) => o.wallId !== wall.id || o.offset >= t + 0.5 || o.offset + o.width <= t - 0.5,
          ),
      )!;
    expect(spot).toBeDefined();

    await page.getByRole('button', { name: 'Dörr', exact: true }).tap();
    await page.touchscreen.tap(spot.screen.x, spot.screen.y);
    const door = (await readFloor(page)).openings.find(
      (o) => o.wallId === spot.wall.id && !openings.some((before) => before.id === o.id),
    )!;
    expect(door).toMatchObject({ kind: 'door', width: 0.9 });
    expect(door.offset).toBeCloseTo(spot.t - 0.45, 1);

    await page.getByRole('button', { name: 'Markera', exact: true }).tap();
    await page.touchscreen.tap(spot.screen.x, spot.screen.y);
    await expect(page.getByRole('region', { name: 'Dörr', exact: true })).toBeVisible();
  });
});
