import { expect, test, type Page } from '@playwright/test';
import { countRenderWindowChanges, readEditor } from './app-modules';

interface FrameStats {
  frames: number;
  /** Frames over 17 ms: long work, or for intervals a dropped frame at 60 Hz. */
  over: number;
  p50: number;
  p95: number;
  max: number;
}

declare global {
  interface Window {
    frameProbe: { start(): void; stop(): { work: number[]; intervals: number[] } };
  }
}

/**
 * Times the main-thread work of each frame: pointer and wheel event dispatch plus animation frame
 * callbacks (where Konva draws), grouped by the frame they ran in. React's deferred renders run as
 * scheduler tasks outside this; dropped frames show up in the intervals between frames instead.
 */
function installFrameProbe() {
  const nativeRaf = window.requestAnimationFrame.bind(window);
  let recording = false;
  let current = 0;
  const work: number[] = [];
  const stamps: number[] = [];
  const flush = () => {
    if (current > 0) work.push(current);
    current = 0;
  };
  const tick = (ts: number) => {
    if (!recording) return;
    stamps.push(ts);
    nativeRaf(tick);
  };
  window.requestAnimationFrame = (cb) =>
    nativeRaf((ts) => {
      const t0 = performance.now();
      cb(ts);
      if (recording) current += performance.now() - t0;
    });
  // A frame's rAF callbacks run after its input events, so the frame closes after them.
  const closeFrame = () => {
    if (recording) {
      nativeRaf(() => setTimeout(flush, 0));
    }
  };
  for (const type of ['pointermove', 'wheel'] as const) {
    let t0 = 0;
    window.addEventListener(type, () => (t0 = performance.now()), { capture: true });
    window.addEventListener(type, () => {
      if (recording) current += performance.now() - t0;
      closeFrame();
    });
  }
  window.frameProbe = {
    start() {
      work.length = 0;
      stamps.length = 0;
      current = 0;
      recording = true;
      nativeRaf(tick);
    },
    stop() {
      recording = false;
      flush();
      return { work: [...work], intervals: stamps.slice(1).map((t, i) => t - stamps[i]!) };
    },
  };
}

function stats(values: number[]): FrameStats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    frames: sorted.length,
    over: sorted.filter((v) => v > 17).length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted.at(-1)!),
  };
}

const nextFrame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );

// Timing depends on the machine, so the 16 ms budget is only asserted on request (PERF_BUDGET=1);
// otherwise the numbers are reported and only a loose bound guards against gross regressions.
const BUDGET_MS = process.env['PERF_BUDGET'] ? 16 : 100;
const SWEEPS = 6;
const STEP_PX = 12;

test('panning the busiest floor of the large synthetic project across render windows fits in a frame', async ({
  page,
}) => {
  await page.addInitScript(installFrameProbe);
  await page.goto('/dev/synthetic/large');
  const canvas = page.getByTestId('floor-editor-canvas');
  await expect(canvas.locator('canvas').first()).toBeVisible();
  await page.waitForTimeout(500);
  const box = (await canvas.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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
  await page.evaluate(() => {
    window.frameProbe.start();
  });
  let x = right;
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const target = sweep % 2 === 0 ? left : right;
    const direction = Math.sign(target - x);
    while ((target - x) * direction > 0) {
      x = direction > 0 ? Math.min(target, x + STEP_PX) : Math.max(target, x - STEP_PX);
      await page.mouse.move(x, center.y + 40 * Math.sin(x / 200));
      await nextFrame(page);
    }
  }
  const pan = await page.evaluate(() => window.frameProbe.stop());
  await page.mouse.up();
  const crossings = await windowChanges();
  expect((await readEditor(page)).viewport).not.toEqual(before.viewport);

  await page.evaluate(() => {
    window.frameProbe.start();
  });
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, i < 20 ? 100 : -100);
    await nextFrame(page);
  }
  const zoom = await page.evaluate(() => window.frameProbe.stop());

  const report = {
    pan: { work: stats(pan.work), interval: stats(pan.intervals), renderWindowChanges: crossings },
    zoom: { work: stats(zoom.work), interval: stats(zoom.intervals) },
  };
  await test.info().attach('frame-times.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  process.stdout.write(`Frame times in ms: ${JSON.stringify(report)}\n`);

  expect(crossings).toBeGreaterThanOrEqual(SWEEPS);
  expect(report.pan.work.frames).toBeGreaterThan(SWEEPS * 50);
  expect(report.pan.work.p95).toBeLessThan(BUDGET_MS);
});
