import { expect, test, type Page } from '@playwright/test';
import { installFrameProbe, nextFrame, stats } from './frame-probe';
import { view3dBuilds, view3dCanvas } from './view3d';

// Timing depends on the machine (and headless Chromium renders WebGL in software), so the targets
// of decision 11 in M9 are only asserted on request (PERF_BUDGET=1); otherwise the numbers are
// reported and only a loose bound guards against gross regressions.
const STRICT = Boolean(process.env['PERF_BUDGET']);
const GPU = Boolean(process.env['PERF_GPU']);
// Headless Chromium draws WebGL with SwiftShader on the CPU, where a frame of all floors takes
// long enough that a three-second orbit would take minutes. PERF_GPU=1 asks for the machine's GPU
// instead, which is what the targets are about.
const STEPS = GPU ? 180 : 24;
if (GPU) {
  test.use({
    launchOptions: { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl-egl'] },
  });
}

const rendererName = (page: Page) =>
  page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });

async function openLarge3d(page: Page) {
  await page.addInitScript(installFrameProbe);
  await page.goto('/dev/synthetic/large?view=3d');
  const canvas = view3dCanvas(page);
  await expect(canvas).toBeVisible();
  await expect.poll(async () => Object.keys(await view3dBuilds(page)).length).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  const box = (await canvas.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, r: box.height / 4 };
}

/** Orbits the camera with a mouse drag in a circle for about `STEPS` frames, recording frames. */
async function orbit(page: Page, center: { x: number; y: number; r: number }) {
  await page.mouse.move(center.x + center.r, center.y);
  await page.mouse.down();
  await page.evaluate(() => {
    window.frameProbe.start();
  });
  const start = Date.now();
  for (let i = 1; i <= STEPS; i++) {
    const a = (i / STEPS) * 4 * Math.PI;
    await page.mouse.move(center.x + center.r * Math.cos(a), center.y + center.r * Math.sin(a));
    await nextFrame(page);
  }
  const frames = await page.evaluate(() => window.frameProbe.stop());
  const seconds = (Date.now() - start) / 1000;
  await page.mouse.up();
  return { work: stats(frames.work), interval: stats(frames.intervals), seconds };
}

async function report(name: string, data: unknown) {
  await test.info().attach(`${name}.json`, {
    body: JSON.stringify(data, null, 2),
    contentType: 'application/json',
  });
  process.stdout.write(`${name} in ms: ${JSON.stringify(data)}\n`);
}

test('orbiting the large synthetic project in 3D, one floor and all floors', async ({ page }) => {
  test.setTimeout(240_000);
  const center = await openLarge3d(page);
  const one = await orbit(page, center);

  await page.getByRole('button', { name: 'Våningar' }).click();
  await page.getByRole('radio', { name: 'Alla våningar' }).check();
  await page.getByRole('checkbox', { name: 'Isärdragen' }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Zooma till allt' }).click();
  await expect.poll(async () => Object.keys(await view3dBuilds(page)).length).toBe(10);
  await page.waitForTimeout(500);
  const all = await orbit(page, center);

  await report('3D orbit frame times', {
    renderer: await rendererName(page),
    oneFloor: one,
    allFloors: all,
  });

  for (const result of [one, all]) {
    expect(result.work.frames).toBeGreaterThan(STEPS / 2);
    expect(result.interval.p50).toBeLessThan(STRICT ? 100 : 500);
  }
  if (STRICT) {
    // Frames are paced by the display: one refresh at 60 Hz is 16.7 ms, two are 33.3 ms.
    expect(one.interval.p50).toBeLessThan(17);
    expect(all.interval.p50).toBeLessThan(34);
  }
});
