import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { countRenderWindowChanges, EDITOR_STORE, readEditor } from './app-modules';
import { installFrameProbe, nextFrame, stats } from './frame-probe';

// Timing depends on the machine, so the budgets are only asserted on request (PERF_BUDGET=1);
// otherwise the numbers are reported and only a loose bound guards against gross regressions.
const STRICT = Boolean(process.env['PERF_BUDGET']);
const BUDGET_MS = STRICT ? 16 : 100;
const SWEEPS = 6;
const STEP_PX = 12;
const MODEL_STORE = '/src/model/store.ts';
/** The Konva layer that holds the model: redrawing it on the large project is the expensive part. */
const MODEL_LAYER = 'areas+walls+openings';

async function openLarge(page: Page) {
  await page.addInitScript(installFrameProbe);
  await page.goto('/dev/synthetic/large');
  const canvas = page.getByTestId('floor-editor-canvas');
  await expect(canvas.locator('canvas').first()).toBeVisible();
  await page.waitForTimeout(500);
  const box = (await canvas.boundingBox())!;
  return { box, center: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

/**
 * Runs `steps` while the frame probe records, and returns the work and interval statistics and how
 * often each Konva layer was drawn.
 */
async function measure(page: Page, steps: () => Promise<void>) {
  await page.evaluate(() => {
    window.frameProbe.start();
  });
  await steps();
  const frames = await page.evaluate(() => window.frameProbe.stop());
  return { work: stats(frames.work), interval: stats(frames.intervals), draws: frames.draws };
}

async function report(name: string, data: unknown) {
  await test.info().attach(`${name}.json`, {
    body: JSON.stringify(data, null, 2),
    contentType: 'application/json',
  });
  process.stdout.write(`${name} in ms: ${JSON.stringify(data)}\n`);
}

test('panning and zooming the busiest floor of the large synthetic project fit in a frame', async ({
  page,
}) => {
  const { box, center } = await openLarge(page);
  const left = box.x + 10;
  const right = box.x + box.width - 10;

  // Zoomed in, so that one sweep across the canvas moves the view past its render window.
  await page.mouse.move(center.x, center.y);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, -100);
    await nextFrame(page);
  }
  const windowChanges = await countRenderWindowChanges(page);
  const before = await readEditor(page);

  await page.mouse.move(right, center.y);
  await page.mouse.down();
  let x = right;
  const pan = await measure(page, async () => {
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
      const target = sweep % 2 === 0 ? left : right;
      const direction = Math.sign(target - x);
      while ((target - x) * direction > 0) {
        x = direction > 0 ? Math.min(target, x + STEP_PX) : Math.max(target, x - STEP_PX);
        await page.mouse.move(x, center.y + 40 * Math.sin(x / 200));
        await nextFrame(page);
      }
    }
  });
  await page.mouse.up();
  const crossings = await windowChanges();
  expect((await readEditor(page)).viewport).not.toEqual(before.viewport);

  // Out to the whole floor and back, through several render windows.
  const zoom = await measure(page, async () => {
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, i < 20 ? 100 : -100);
      await nextFrame(page);
    }
  });

  await report('Frame times', { pan: { ...pan, renderWindowChanges: crossings }, zoom });

  expect(crossings).toBeGreaterThanOrEqual(SWEEPS);
  expect(pan.work.frames).toBeGreaterThan(SWEEPS * 50);
  expect(pan.work.p95).toBeLessThan(BUDGET_MS);
  expect(zoom.work.p95).toBeLessThan(BUDGET_MS);
  if (STRICT) {
    // The deferred render runs outside the work probe; a slow one shows up as dropped frames.
    expect(pan.interval.p95).toBeLessThan(17);
    expect(pan.interval.over).toBeLessThanOrEqual(3);
  }
});

const countWalls = (page: Page) =>
  page.evaluate(async (url) => {
    const { modelStore } = (await import(/* @vite-ignore */ url)) as {
      modelStore: {
        getState(): { model: { floors: Record<string, { data: { walls: object } }> } };
      };
    };
    return Object.values(modelStore.getState().model.floors).reduce(
      (n, floor) => n + Object.keys(floor.data.walls).length,
      0,
    );
  }, MODEL_STORE);

test('committing a 20-wall polyline on the large project takes one short frame', async ({
  page,
}) => {
  const { box } = await openLarge(page);
  const { viewport } = await readEditor(page);
  const toPage = (x: number, y: number) => ({
    x: box.x + x * viewport.scale + viewport.x,
    y: box.y + y * viewport.scale + viewport.y,
  });
  const before = await countWalls(page);
  await page.keyboard.press('w');
  // The zigzag of walls.spec.ts, with fewer hover steps since only the commit is measured.
  let from = toPage(2, 2);
  await page.mouse.click(from.x, from.y);
  for (let i = 1; i <= 20; i++) {
    const to = toPage(2 + i * 2.1, i % 2 === 0 ? 2 : 6.3);
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
    await page.mouse.move(to.x, to.y);
    await page.mouse.click(to.x, to.y);
    from = to;
  }
  await page.waitForTimeout(300);

  const commit = await measure(page, async () => {
    await page.keyboard.press('Enter');
    for (let i = 0; i < 30; i++) await nextFrame(page);
  });
  await report('Commit frame times', commit);

  expect(await countWalls(page)).toBe(before + 20);
  // The longest interval is the frame the commit lands in.
  expect(commit.interval.max).toBeLessThan(STRICT ? 50 : 250);
});

interface Pt {
  x: number;
  y: number;
}

interface FloorSnapshot {
  walls: Record<string, { id: string; a: Pt; b: Pt }>;
  rooms: Record<string, { id: string; polygon: Pt[] }>;
  openings: Record<string, { id: string; wallId: string; offset: number; width: number }>;
}

/** The floor open in the editor, and selects `select` on it. */
const openFloor = (page: Page, select: { collection: string; id: string }[] = []) =>
  page.evaluate(
    async ([modelUrl, editorUrl, items]) => {
      const { modelStore } = (await import(/* @vite-ignore */ modelUrl)) as {
        modelStore: {
          getState(): { model: { floors: Record<string, { data: FloorSnapshot }> } };
        };
      };
      const { editorStore } = (await import(/* @vite-ignore */ editorUrl)) as {
        editorStore: { getState(): { floorId: string; select(items: unknown[]): void } };
      };
      if (items.length > 0) editorStore.getState().select(items);
      const { walls, rooms, openings } =
        modelStore.getState().model.floors[editorStore.getState().floorId]!.data;
      return { walls, rooms, openings };
    },
    [MODEL_STORE, EDITOR_STORE, select] as const,
  );

/**
 * Moves the pointer past the drag threshold in the direction of `by`, which starts the drag and
 * hides the dragged item on the model layer once, and returns where the pointer is now.
 */
async function startDrag(page: Page, from: Pt, by: Pt, move: (to: Pt) => Promise<unknown>) {
  const length = Math.hypot(by.x, by.y);
  const to = { x: from.x + (by.x / length) * 10, y: from.y + (by.y / length) * 10 };
  await move(to);
  await nextFrame(page);
  await nextFrame(page);
  return to;
}

test('tool previews on the large project redraw only what they change', async ({ page }) => {
  const { box, center } = await openLarge(page);
  // Zoomed in a little, so that handles and openings are big enough to grab.
  await page.mouse.move(center.x, center.y);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -100);
    await nextFrame(page);
  }
  await page.waitForTimeout(300);
  const { viewport } = await readEditor(page);
  const toPage = (p: Pt) => ({
    x: box.x + p.x * viewport.scale + viewport.x,
    y: box.y + p.y * viewport.scale + viewport.y,
  });
  const hover = (from: Pt) =>
    measure(page, async () => {
      for (let i = 0; i < 60; i++) {
        await page.mouse.move(from.x + 4 * i, from.y + 40 * Math.sin(i / 6));
        await nextFrame(page);
      }
    });
  const drag = async (start: Pt, by: Pt) => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const from = await startDrag(page, start, by, (p) => page.mouse.move(p.x, p.y));
    const frames = await measure(page, async () => {
      for (let i = 1; i <= 40; i++) {
        await page.mouse.move(from.x + (by.x * i) / 40, from.y + (by.y * i) / 40);
        await nextFrame(page);
      }
    });
    await page.mouse.up();
    // A handle took the drag, rather than the view.
    expect((await readEditor(page)).viewport).toEqual(viewport);
    await page.keyboard.press('Control+z');
    return frames;
  };
  const start = { x: center.x - 120, y: center.y - 20 };

  const results: Record<string, Awaited<ReturnType<typeof measure>>> = {};
  for (const [name, key, taps] of [
    ['select', 'v', 0],
    ['wall', 'w', 1],
    ['door', 'd', 0],
    ['window', 'n', 0],
    ['passage', 'p', 0],
    ['room', 'r', 2],
    ['zone', 'z', 2],
    ['fill room', 'y', 0],
    ['grid', 'g', 0],
  ] as const) {
    await page.keyboard.press(key);
    for (let i = 0; i < taps; i++) await page.mouse.click(start.x - 30 * (i + 1), start.y);
    // The tool switch redraws the layers that depend on the tool; that is not the hover's cost.
    await page.waitForTimeout(300);
    results[name] = await hover(start);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('v');

  const { walls, rooms, openings } = await openFloor(page);
  const near = (p: Pt) => Math.abs(toPage(p).x - center.x) + Math.abs(toPage(p).y - center.y);
  const closest = <T>(items: T[], at: (item: T) => Pt) =>
    items.sort((a, b) => near(at(a)) - near(at(b)))[0]!;
  const wall = closest(Object.values(walls), (w) => w.a);
  await openFloor(page, [{ collection: 'walls', id: wall.id }]);
  results['wall corner drag'] = await drag(toPage(wall.a), { x: 40, y: 30 });

  const room = closest(Object.values(rooms), (r) => r.polygon[0]!);
  await openFloor(page, [{ collection: 'rooms', id: room.id }]);
  results['room corner drag'] = await drag(toPage(room.polygon[0]!), { x: 30, y: 30 });

  const centreOf = (o: (typeof openings)[string]) => {
    const { a, b } = walls[o.wallId]!;
    const t = (o.offset + o.width / 2) / Math.hypot(b.x - a.x, b.y - a.y);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const opening = closest(Object.values(openings), centreOf);
  await openFloor(page, [{ collection: 'openings', id: opening.id }]);
  const along = walls[opening.wallId]!;
  const length = Math.hypot(along.b.x - along.a.x, along.b.y - along.a.y);
  const slide = {
    x: ((along.b.x - along.a.x) / length) * 0.3 * viewport.scale,
    y: ((along.b.y - along.a.y) / length) * 0.3 * viewport.scale,
  };
  results['opening slide'] = await drag(toPage(centreOf(opening)), slide);
  for (const name of ['wall corner drag', 'room corner drag', 'opening slide']) {
    expect(results[name]!.draws['overlays'], name).toBeGreaterThan(30);
  }

  await report(
    'Tool preview frame times',
    Object.fromEntries(
      Object.entries(results).map(([name, r]) => [name, { ...r.work, draws: r.draws }]),
    ),
  );
  for (const [name, r] of Object.entries(results)) {
    expect(r.work.frames, name).toBeGreaterThan(20);
    expect(r.work.p95, name).toBeLessThan(BUDGET_MS);
    // Previews are drawn on the overlays layer, so the model is not redrawn.
    expect(r.draws[MODEL_LAYER] ?? 0, name).toBe(0);
  }
});

test.describe('on a phone with the CPU slowed down four times', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  const touch = (
    cdp: CDPSession,
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    touchPoints: { x: number; y: number }[],
  ) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: touchPoints.map((p, id) => ({ ...p, id })),
    });

  test('panning and pinch-zooming the large project stays usable', async ({ page }) => {
    const { box, center } = await openLarge(page);
    const cdp = await page.context().newCDPSession(page);
    const fingers = (spread: number) => [
      { x: center.x - spread, y: center.y },
      { x: center.x + spread, y: center.y },
    ];
    const pinch = async (from: number, to: number) => {
      const step = Math.sign(to - from) * 4;
      await touch(cdp, 'touchStart', fingers(from));
      for (let spread = from + step; (to - spread) * step >= 0; spread += step) {
        await touch(cdp, 'touchMove', fingers(spread));
        await nextFrame(page);
      }
      await touch(cdp, 'touchEnd', []);
    };
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    // In to five times the fitted zoom and back out, twice.
    const zoom = await measure(page, async () => {
      for (let i = 0; i < 2; i++) {
        await pinch(30, 150);
        await pinch(150, 30);
      }
    });

    await pinch(30, 120);
    const windowChanges = await countRenderWindowChanges(page);
    const left = box.x + 20;
    const right = box.x + box.width - 20;
    const pan = await measure(page, async () => {
      for (let sweep = 0; sweep < 4; sweep++) {
        const [start, end] = sweep % 2 === 0 ? [right, left] : [left, right];
        const step = Math.sign(end - start) * STEP_PX;
        await touch(cdp, 'touchStart', [{ x: start, y: center.y }]);
        for (let x = start + step; (end - x) * step >= 0; x += step) {
          await touch(cdp, 'touchMove', [{ x, y: center.y + 60 * Math.sin(x / 120) }]);
          await nextFrame(page);
        }
        await touch(cdp, 'touchEnd', []);
      }
    });
    const crossings = await windowChanges();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    await report('Phone frame times', { pan: { ...pan, renderWindowChanges: crossings }, zoom });

    expect(zoom.work.frames).toBeGreaterThan(100);
    expect(pan.work.frames).toBeGreaterThan(80);
    expect(crossings).toBeGreaterThan(0);
    // Usable: well under the 100 ms at which a gesture stops feeling attached to the finger.
    expect(pan.work.p95).toBeLessThan(100);
    expect(zoom.work.p95).toBeLessThan(100);
  });

  test('dragging a room corner on the large project redraws only the overlays', async ({
    page,
  }) => {
    const { box, center } = await openLarge(page);
    const cdp = await page.context().newCDPSession(page);
    const { viewport } = await readEditor(page);
    const toPage = (p: Pt) => ({
      x: box.x + p.x * viewport.scale + viewport.x,
      y: box.y + p.y * viewport.scale + viewport.y,
    });
    const { rooms } = await openFloor(page);
    const near = (p: Pt) => Math.abs(toPage(p).x - center.x) + Math.abs(toPage(p).y - center.y);
    const room = Object.values(rooms).sort((a, b) => near(a.polygon[0]!) - near(b.polygon[0]!))[0]!;
    const before = room.polygon;
    await openFloor(page, [{ collection: 'rooms', id: room.id }]);
    await page.waitForTimeout(300);
    // A third of the way towards the opposite corner, so the room stays valid and the drag commits.
    const [corner, opposite] = [toPage(room.polygon[0]!), toPage(room.polygon[2]!)];
    const by = { x: (opposite.x - corner.x) / 3, y: (opposite.y - corner.y) / 3 };

    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await touch(cdp, 'touchStart', [corner]);
    const from = await startDrag(page, corner, by, (p) => touch(cdp, 'touchMove', [p]));
    const drag = await measure(page, async () => {
      for (let i = 1; i <= 40; i++) {
        await touch(cdp, 'touchMove', [
          { x: from.x + (by.x * i) / 40, y: from.y + (by.y * i) / 40 },
        ]);
        await nextFrame(page);
      }
    });
    await touch(cdp, 'touchEnd', []);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    await report('Phone room corner drag frame times', { ...drag.work, draws: drag.draws });

    const { rooms: after } = await openFloor(page);
    expect(after[room.id]!.polygon).not.toEqual(before);
    expect((await readEditor(page)).viewport).toEqual(viewport);
    expect(drag.work.frames).toBeGreaterThan(20);
    expect(drag.work.p95).toBeLessThan(STRICT ? 50 : 100);
    expect(drag.draws['overlays']).toBeGreaterThan(0);
    expect(drag.draws[MODEL_LAYER] ?? 0).toBe(0);
  });
});
