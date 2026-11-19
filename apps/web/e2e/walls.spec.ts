import { expect, test, type Page } from '@playwright/test';
import { EDITOR_STORE, readEditor } from './app-modules';
import { installFrameProbe, nextFrame, stats } from './frame-probe';

const MODEL_STORE = '/src/model/store.ts';

interface Pt {
  x: number;
  y: number;
}

interface WallSnapshot {
  id: string;
  a: Pt;
  b: Pt;
}

/** The walls of the floor open in the editor. */
const readWalls = (page: Page) =>
  page.evaluate(
    async ([modelUrl, editorUrl]) => {
      const { modelStore } = (await import(/* @vite-ignore */ modelUrl!)) as {
        modelStore: {
          getState(): {
            model: { floors: Record<string, { data: { walls: Record<string, WallSnapshot> } }> };
          };
        };
      };
      const { editorStore } = (await import(/* @vite-ignore */ editorUrl!)) as {
        editorStore: { getState(): { floorId: string } };
      };
      const floor = modelStore.getState().model.floors[editorStore.getState().floorId]!;
      return Object.values(floor.data.walls);
    },
    [MODEL_STORE, EDITOR_STORE],
  );

async function open(page: Page, size: 'small' | 'large') {
  await page.goto(`/dev/synthetic/${size}`);
  const canvas = page.getByTestId('floor-editor-canvas');
  await expect(canvas.locator('canvas').first()).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const { viewport } = await readEditor(page);
  const toPage = (world: Pt) => ({
    x: box.x + world.x * viewport.scale + viewport.x,
    y: box.y + world.y * viewport.scale + viewport.y,
  });
  return { toPage, scale: viewport.scale };
}

const added = (before: WallSnapshot[], after: WallSnapshot[]) => {
  const ids = new Set(before.map((w) => w.id));
  return after.filter((w) => !ids.has(w.id));
};

const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

// Inside the first room of the small villa, a metre or more from its walls.
const L = [
  { x: 1, y: 1 },
  { x: 3, y: 1 },
  { x: 3, y: 3 },
];

test('drawing walls with the mouse, undoing them, and dragging a corner', async ({ page }) => {
  const { toPage } = await open(page, 'small');
  const before = await readWalls(page);
  await page.keyboard.press('w');
  await expect(page.getByRole('button', { name: 'Vägg', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  for (const p of L.slice(0, -1)) {
    const at = toPage(p);
    await page.mouse.click(at.x, at.y);
  }
  // Slightly off: the 90° step from the previous point straightens it.
  const last = toPage(L[2]!);
  await page.mouse.move(last.x + 2, last.y, { steps: 4 });
  await page.mouse.dblclick(last.x + 2, last.y);
  const drawn = added(before, await readWalls(page));
  expect(drawn).toHaveLength(2);
  expect(near(drawn[1]!.b, L[2]!)).toBe(true);

  await page.keyboard.press('Control+z');
  expect(added(before, await readWalls(page))).toHaveLength(0);
  await page.keyboard.press('Control+Shift+z');
  expect(added(before, await readWalls(page))).toHaveLength(2);

  // Select the second wall, then drag the shared corner: both walls follow.
  await page.keyboard.press('v');
  const mid = toPage({ x: 3, y: 2 });
  await page.mouse.click(mid.x, mid.y);
  await expect(page.getByRole('region', { name: 'Vägg' })).toBeVisible();
  const corner = toPage(L[1]!);
  const target = toPage({ x: 3.5, y: 1.5 });
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  const moved = added(before, await readWalls(page));
  const ends = moved.flatMap((w) => [w.a, w.b]).filter((p) => !near(p, L[0]!) && !near(p, L[2]!));
  expect(ends).toHaveLength(2);
  expect(near(ends[0]!, ends[1]!)).toBe(true);
  expect(ends[0]!.x).toBeGreaterThan(3.2);
  await page.keyboard.press('Control+z');
  expect(added(before, await readWalls(page)).some((w) => near(w.b, L[1]!))).toBe(true);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('tapping places corners and tapping the last one finishes', async ({ page }) => {
    const { toPage } = await open(page, 'small');
    const before = await readWalls(page);
    await page.getByRole('button', { name: 'Vägg', exact: true }).tap();
    for (const p of L) {
      const at = toPage(p);
      await page.touchscreen.tap(at.x, at.y);
    }
    const last = toPage(L[2]!);
    await page.touchscreen.tap(last.x + 3, last.y + 3);
    const drawn = added(before, await readWalls(page));
    expect(drawn).toHaveLength(2);
    expect(near(drawn[0]!.a, L[0]!)).toBe(true);
    expect((await readEditor(page)).tool).toBe('wall');
  });
});

const BUDGET_MS = process.env['PERF_BUDGET'] ? 16 : 100;

test('drawing 20 walls on the busiest floor of the large project stays within a frame', async ({
  page,
}) => {
  await page.addInitScript(installFrameProbe);
  const { toPage } = await open(page, 'large');
  const before = await readWalls(page);
  await page.keyboard.press('w');
  await page.evaluate(() => {
    window.frameProbe.start();
  });
  // A zigzag across the offices, hovering between clicks as a person would.
  let from = toPage({ x: 2, y: 2 });
  await page.mouse.click(from.x, from.y);
  for (let i = 1; i <= 20; i++) {
    const to = toPage({ x: 2 + i * 2.1, y: i % 2 === 0 ? 2 : 6.3 });
    for (let s = 1; s <= 10; s++) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * s) / 10,
        from.y + ((to.y - from.y) * s) / 10,
      );
      await nextFrame(page);
    }
    await page.mouse.click(to.x, to.y);
    from = to;
  }
  await page.keyboard.press('Enter');
  const frames = await page.evaluate(() => window.frameProbe.stop());
  const report = { work: stats(frames.work), interval: stats(frames.intervals) };
  await test.info().attach('wall-drawing-frame-times.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  process.stdout.write(`Wall drawing frame times in ms: ${JSON.stringify(report)}\n`);

  expect(added(before, await readWalls(page))).toHaveLength(20);
  expect(report.work.p95).toBeLessThan(BUDGET_MS);
});
