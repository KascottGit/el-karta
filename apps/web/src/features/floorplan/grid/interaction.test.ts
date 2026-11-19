import { evenGrid, generateProject, gridLines } from '@el-karta/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import type { CanvasContext, CanvasPointer } from '../canvas/extension';
import { resolveExtensions } from '../canvas/extension';
import { extensions } from '../extensions';
import { gridExtension } from './extension';
import { editGrid, GRID_TOOL, gridLineHandle, gridTool, gridUiStore } from './interaction';

const model = generateProject('small');
const floor = Object.values(model.floors)[0]!;
const wall = Object.values(floor.data.walls)[0]!;
const ctx: CanvasContext = {
  floorId: floor.id,
  itemAt: () => null,
  pxToWorld: (px) => px,
  zoomToFit: () => {},
};
const grid = evenGrid({
  origin: { x: 0, y: 0 },
  x: { count: 3, spacing: 5 },
  y: { count: 2, spacing: 4 },
});

const pointer = (x: number, y: number): CanvasPointer => ({
  world: { x, y },
  screen: { x, y },
  kind: 'mouse',
  shiftKey: false,
  altKey: false,
  modKey: false,
  onHandle: true,
});

const currentGrid = () => modelStore.getState().model?.floors[floor.id]?.data.grid;

beforeEach(() => {
  modelStore.getState().load(model, { discardUnsaved: true });
  editorStore.getState().openFloor(floor.id);
  gridUiStore.setState({ pointer: null, drag: null });
});

describe('grid editing', () => {
  it('applies grid changes as undoable edits and removes an emptied grid', () => {
    editGrid(floor.id, () => grid);
    expect(currentGrid()).toEqual(grid);
    editGrid(floor.id, () => null);
    expect(currentGrid()).toBeUndefined();
    modelStore.getState().undo();
    expect(currentGrid()).toEqual(grid);
  });

  it('skips the edit when nothing changes', () => {
    const before = modelStore.getState().past.length;
    editGrid(floor.id, (g) => g);
    expect(modelStore.getState().past).toHaveLength(before);
  });

  it('drags a line by its bubble, keeping the grab offset and rounding to centimetres', () => {
    editGrid(floor.id, () => grid);
    const payload = { axis: 'x' as const, index: 1, from: 5 };
    gridLineHandle.onDragStart!(payload, pointer(5.2, -3), pointer(5.3, -3), ctx);
    gridLineHandle.onDrag(payload, pointer(7.2345, -2), ctx);
    expect(gridUiStore.getState().drag).toMatchObject({ axis: 'x', index: 1, pos: 7.03 });
    expect(gridLines(currentGrid()!, 'x')[1]!.pos).toBe(5);

    gridLineHandle.onDragEnd!(payload, pointer(11.7, -2), ctx);
    expect(gridUiStore.getState().drag).toBeNull();
    expect(gridLines(currentGrid()!, 'x').map((l) => [l.label, l.pos])).toEqual([
      ['A', 0],
      ['B', 10],
      ['C', 11.5],
    ]);
  });

  it('drops the preview when a drag is cancelled', () => {
    editGrid(floor.id, () => grid);
    const payload = { axis: 'y' as const, index: 0, from: 0 };
    gridLineHandle.onDragStart!(payload, pointer(-1, 0), pointer(-1, 0.1), ctx);
    gridLineHandle.onDragCancel!(payload, ctx);
    expect(gridUiStore.getState().drag).toBeNull();
    expect(currentGrid()).toEqual(grid);
  });

  it('tracks the pointer while the grid tool is active, including taps for touch', () => {
    gridTool.onHover!(pointer(1, 2), ctx);
    expect(gridUiStore.getState().pointer).toEqual({ x: 1, y: 2 });
    gridTool.onTap!(pointer(3, 4), ctx);
    expect(gridUiStore.getState().pointer).toEqual({ x: 3, y: 4 });
    gridTool.onLeave!(ctx);
    expect(gridUiStore.getState().pointer).toBeNull();
  });
});

describe('grid extension', () => {
  it('registers without clashing with the other extensions', () => {
    expect(() => resolveExtensions(extensions)).not.toThrow();
  });

  it('shows the grid panel with the grid tool, and the cell panel for a selection on a floor with a grid', () => {
    const [toolPanel, cellPanel] = gridExtension.panels!;
    const visible = (panel: typeof toolPanel) =>
      panel!.visible(editorStore.getState(), modelStore.getState());

    editorStore.getState().setTool(GRID_TOOL);
    expect(visible(toolPanel)).toBe(true);
    editorStore.getState().setTool('select');
    expect(visible(toolPanel)).toBe(false);

    editorStore.getState().select([{ collection: 'walls', id: wall.id }]);
    expect(visible(cellPanel)).toBe(false);
    editGrid(floor.id, () => grid);
    expect(visible(cellPanel)).toBe(true);
    editorStore.getState().select([]);
    expect(visible(cellPanel)).toBe(false);
  });

  it('adds the grid and room for its labels to zoom to fit', () => {
    const [layer] = gridExtension.layers!;
    const fit = layer!.bounds!({ ...floor, data: { ...floor.data, grid } });
    expect(fit!.minX).toBeLessThan(0);
    expect(fit!.minY).toBeLessThan(0);
    expect(layer!.bounds!({ ...floor, data: { ...floor.data } })).toBeNull();
  });
});
