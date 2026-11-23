import { expect, test, type Page } from '@playwright/test';
import { readOpenFloor, readSelection, worldToPage, type Pt } from './app-modules';
import { openSynthetic } from './editor';
import { finger, mouse, type Input } from './input';

interface OpeningSnapshot {
  id: string;
  wallId: string;
  kind: string;
  offset: number;
  width: number;
  hinge?: string;
}

/** The walls and openings of the floor open in the editor. */
const readFloor = async (page: Page) => {
  const { walls, openings } = await readOpenFloor<{
    walls: Record<string, { id: string; a: Pt; b: Pt }>;
    openings: Record<string, OpeningSnapshot>;
  }>(page, ['walls', 'openings']);
  return { walls: Object.values(walls), openings: Object.values(openings) };
};

test('placing a door and a window on a new wall, sliding the door and undoing it', async ({
  page,
}) => {
  const toPage = await openSynthetic(page, 'small');
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
    const toPage = await openSynthetic(page, 'small');
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

interface Area {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const WIDEN = 0.3;

/**
 * Selects a window in `area` with room beside its end, widens it from that side by dragging its
 * edge handle, and undoes it.
 */
async function widenWindow(page: Page, input: Input, area: (canvas: Area) => Area) {
  const box = (await page.getByTestId('floor-editor-canvas').boundingBox())!;
  const bounds = area({ x0: box.x, x1: box.x + box.width, y0: box.y, y1: box.y + box.height });
  const { walls, openings } = await readFloor(page);
  const toPage = await worldToPage(page);
  const inArea = (p: Pt) => {
    const s = toPage(p);
    return s.x > bounds.x0 && s.x < bounds.x1 && s.y > bounds.y0 && s.y < bounds.y1;
  };
  const found = openings
    .filter((o) => o.kind === 'window')
    .flatMap((window) => {
      const wall = walls.find((w) => w.id === window.wallId)!;
      const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
      const at = (t: number) => ({
        x: wall.a.x + ((wall.b.x - wall.a.x) * t) / length,
        y: wall.a.y + ((wall.b.y - wall.a.y) * t) / length,
      });
      const others = openings.filter((o) => o.wallId === wall.id && o.id !== window.id);
      const start = window.offset;
      const end = start + window.width;
      const sides = [
        {
          side: 'end' as const,
          from: end,
          free: end + WIDEN + 0.1 < length && others.every((o) => o.offset >= end + WIDEN + 0.1),
        },
        {
          side: 'start' as const,
          from: start,
          free:
            start - WIDEN - 0.1 > 0 &&
            others.every((o) => o.offset + o.width <= start - WIDEN - 0.1),
        },
      ];
      return sides.flatMap(({ side, from, free }) => {
        const points = [
          at(start + window.width / 2),
          at(from),
          at(side === 'end' ? from + WIDEN : from - WIDEN),
        ];
        return free && points.every(inArea)
          ? [{ window, side, centre: points[0]!, edge: points[1]!, to: points[2]! }]
          : [];
      });
    })[0];
  expect(found).toBeDefined();
  const { window, side, centre, edge, to } = found!;

  await input.tap(toPage(centre));
  expect(await readSelection(page)).toEqual([{ collection: 'openings', id: window.id }]);
  await input.drag(toPage(edge), toPage(to));
  const widened = (await readFloor(page)).openings.find((o) => o.id === window.id)!;
  // The other edge stays where it was.
  if (side === 'end') expect(widened.offset).toBeCloseTo(window.offset, 6);
  else expect(widened.offset + widened.width).toBeCloseTo(window.offset + window.width, 6);
  expect(Math.abs(widened.width - (window.width + WIDEN))).toBeLessThan(0.03);
  // Snapping is on, so the width is in whole centimetres.
  expect(Math.round(widened.width * 100) / 100).toBeCloseTo(widened.width, 9);

  await input.button('Ångra');
  expect((await readFloor(page)).openings.find((o) => o.id === window.id)).toEqual(window);
}

test('widening a selected window from one side with the mouse, and undoing it', async ({
  page,
}) => {
  await openSynthetic(page, 'small');
  // Clear of the toolbar on the left and the side panel at the top right.
  await widenWindow(page, mouse(page), (c) => ({
    x0: c.x0 + 80,
    x1: c.x1 - 360,
    y0: c.y0 + 20,
    y1: c.y1 - 20,
  }));
});

test.describe('widening on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('widening a selected window from one side with a finger, and undoing it', async ({
    page,
  }) => {
    await openSynthetic(page, 'small');
    // Above the bottom sheet that opens for the selected window.
    await widenWindow(page, await finger(page), (c) => ({
      x0: c.x0 + 30,
      x1: c.x1 - 30,
      y0: c.y0 + 60,
      y1: c.y0 + (c.y1 - c.y0) * 0.45,
    }));
  });
});
