import type { Page } from '@playwright/test';

/**
 * The dev server serves source modules by URL, and the browser keeps one instance per URL, so a
 * test can read the app's own stores without any test hooks in the app.
 */
export const EDITOR_STORE = '/src/features/floorplan/editor-store.ts';
export const TEST_HANDLE = '/src/features/floorplan/dev/test-handle.ts';

interface Pt {
  x: number;
  y: number;
}

export interface EditorSnapshot {
  viewport: { x: number; y: number; scale: number };
  selection: number;
  tool: string;
}

export const readEditor = (page: Page) =>
  page.evaluate(async (url) => {
    const { editorStore } = (await import(/* @vite-ignore */ url)) as {
      editorStore: {
        getState(): { viewport: EditorSnapshot['viewport']; selection: unknown[]; tool: string };
      };
    };
    const s = editorStore.getState();
    return { viewport: s.viewport, selection: s.selection.length, tool: s.tool };
  }, EDITOR_STORE);

export const readTestHandle = (page: Page) =>
  page.evaluate(async (url) => {
    const { testHandleStore } = (await import(/* @vite-ignore */ url)) as {
      testHandleStore: { getState(): { at: Pt; events: string[] } };
    };
    return testHandleStore.getState();
  }, TEST_HANDLE);

/** Starts counting render-window changes; the returned function reads the count. */
export async function countRenderWindowChanges(page: Page) {
  await page.evaluate(async (url) => {
    const { editorStore } = (await import(/* @vite-ignore */ url)) as {
      editorStore: {
        subscribe(
          listener: (s: { renderWindow: unknown }, prev: { renderWindow: unknown }) => void,
        ): void;
      };
    };
    const counter = window as unknown as { renderWindowChanges: number };
    counter.renderWindowChanges = 0;
    editorStore.subscribe((s, prev) => {
      if (s.renderWindow !== prev.renderWindow) counter.renderWindowChanges++;
    });
  }, EDITOR_STORE);
  return () =>
    page.evaluate(() => (window as unknown as { renderWindowChanges: number }).renderWindowChanges);
}
