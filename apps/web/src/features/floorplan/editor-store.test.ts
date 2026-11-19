import { describe, expect, it } from 'vitest';
import { createEditorStore, DEFAULT_TOOL } from './editor-store';
import { contains } from './canvas/rect';
import { panBy, visibleRect, worldToScreen } from './canvas/viewport';

const floorA = crypto.randomUUID();
const floorB = crypto.randomUUID();

function setup() {
  const store = createEditorStore();
  store.getState().setSize({ width: 800, height: 600 });
  return store;
}

describe('editor store', () => {
  it('starts with the default tool, and switching tools drops the drawing in progress', () => {
    const store = setup();
    expect(store.getState().tool).toBe(DEFAULT_TOOL);
    store.getState().setDrawing({ points: [{ x: 0, y: 0 }], hover: { x: 1, y: 1 } });
    store.getState().setTool('wall');
    expect(store.getState()).toMatchObject({ tool: 'wall', drawing: null });
  });

  it('clears selection and drawing on another floor but keeps the view', () => {
    const store = setup();
    store.getState().openFloor(floorA);
    store.getState().select([{ collection: 'walls', id: crypto.randomUUID() }]);
    store.getState().setDrawing({ points: [], hover: null });
    store.getState().setViewport({ x: 10, y: 20, scale: 30 });
    store.getState().openFloor(floorA);
    expect(store.getState().selection).toHaveLength(1);

    store.getState().openFloor(floorB);
    expect(store.getState()).toMatchObject({
      floorId: floorB,
      selection: [],
      drawing: null,
      viewport: { x: 10, y: 20, scale: 30 },
    });
  });

  it('keeps the render window during a small pan and covers the view after a large one', () => {
    const store = setup();
    store.getState().setViewport({ x: 0, y: 0, scale: 20 });
    const first = store.getState().renderWindow;
    expect(
      contains(first.rect, visibleRect(store.getState().viewport, store.getState().size)),
    ).toBe(true);

    store.getState().setViewport(panBy(store.getState().viewport, 50, -30));
    expect(store.getState().renderWindow).toBe(first);

    store.getState().setViewport(panBy(store.getState().viewport, 5000, 0));
    const { renderWindow, viewport, size } = store.getState();
    expect(renderWindow).not.toBe(first);
    expect(contains(renderWindow.rect, visibleRect(viewport, size))).toBe(true);
  });

  it('updates the render window when the canvas grows', () => {
    const store = setup();
    store.getState().setSize({ width: 4000, height: 3000 });
    const { renderWindow, viewport, size } = store.getState();
    expect(contains(renderWindow.rect, visibleRect(viewport, size))).toBe(true);
  });

  it('fits bounds into the measured canvas', () => {
    const store = setup();
    store.getState().fit({ minX: 10, minY: 10, maxX: 20, maxY: 15 });
    const center = worldToScreen(store.getState().viewport, { x: 15, y: 12.5 });
    expect(center.x).toBeCloseTo(400);
    expect(center.y).toBeCloseTo(300);
  });
});
