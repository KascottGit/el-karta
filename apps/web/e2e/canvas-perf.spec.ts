import { expect, test, type Page } from '@playwright/test';

interface FrameStats {
  frames: number;
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
 * callbacks (where Konva draws), grouped by the frame they ran in.
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

test('panning and zooming the busiest floor of the large synthetic project fits in a frame', async ({
  page,
}) => {
  await page.addInitScript(installFrameProbe);
  await page.goto('/dev/synthetic/large');
  const canvas = page.getByTestId('floor-editor-canvas');
  await expect(canvas.locator('canvas').first()).toBeVisible();
  await page.waitForTimeout(500);
  const box = (await canvas.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const before = await canvas.screenshot();

  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.evaluate(() => {
    window.frameProbe.start();
  });
  for (let i = 1; i <= 120; i++) {
    const angle = (i / 120) * 2 * Math.PI;
    await page.mouse.move(center.x + 150 * Math.sin(angle), center.y + 80 * (1 - Math.cos(angle)));
    await nextFrame(page);
  }
  const pan = await page.evaluate(() => window.frameProbe.stop());
  await page.mouse.move(center.x + 120, center.y + 60);
  await page.mouse.up();
  await nextFrame(page);
  expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);

  await page.evaluate(() => {
    window.frameProbe.start();
  });
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, i < 30 ? -40 : 40);
    await nextFrame(page);
  }
  const zoom = await page.evaluate(() => window.frameProbe.stop());

  const report = {
    pan: { work: stats(pan.work), interval: stats(pan.intervals) },
    zoom: { work: stats(zoom.work), interval: stats(zoom.intervals) },
  };
  await test.info().attach('frame-times.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  process.stdout.write(`Frame times in ms: ${JSON.stringify(report)}\n`);

  expect(report.pan.work.frames).toBeGreaterThan(60);
  expect(report.pan.work.p95).toBeLessThan(16);
});
