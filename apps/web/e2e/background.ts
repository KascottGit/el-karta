import type { Page } from '@playwright/test';
import { MODEL_STORE, worldToPage, type Pt } from './app-modules';

const IMAGES = '/src/features/floorplan/background/images.ts';
export const fixture = (name: string) => new URL(`fixtures/${name}`, import.meta.url).pathname;

// plan.png is drawn at 8 mm per pixel: its dimension line runs from (100, 550) to (600, 550), 4 m.
export const DIMENSION = { a: { x: 100, y: 550 }, b: { x: 600, y: 550 }, metres: 4 };
export const TRUE_METRES_PER_PIXEL = 0.008;

interface FloorBackground {
  background?: { attachmentId: string; pdfPage?: number; offset: Pt; rotation: number };
  scale?: { source: string; metresPerPixel: number };
}

/** The open floor's background and scale, and the loaded image's size, read from the app's stores. */
export const readBackground = (page: Page) =>
  page.evaluate(
    async ([modelUrl, imagesUrl]) => {
      const { modelStore } = (await import(/* @vite-ignore */ modelUrl!)) as {
        modelStore: {
          getState(): { model: { floors: Record<string, { data: FloorBackground }> } | null };
        };
      };
      const { imageStore } = (await import(/* @vite-ignore */ imagesUrl!)) as {
        imageStore: {
          getState(): Record<string, { status: string; size?: { width: number; height: number } }>;
        };
      };
      const floorId = /floors\/([^/?]+)/.exec(location.pathname)?.[1] ?? '';
      const data = modelStore.getState().model?.floors[floorId]?.data;
      const image = data?.background && imageStore.getState()[data.background.attachmentId];
      return { background: data?.background, scale: data?.scale, image };
    },
    [MODEL_STORE, IMAGES],
  );

/** Image pixels to page pixels before a scale is set: the image is then shown at 1 cm per pixel from the plan origin. */
export async function unscaledImageToPage(page: Page) {
  const toPage = await worldToPage(page);
  return (px: Pt) => toPage({ x: px.x * 0.01, y: px.y * 0.01 });
}
