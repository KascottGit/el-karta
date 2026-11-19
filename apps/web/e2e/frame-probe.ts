import type { Page } from '@playwright/test';

export interface FrameStats {
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
export function installFrameProbe() {
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

export function stats(values: number[]): FrameStats {
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

export const nextFrame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );
