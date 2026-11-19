import { generateProject } from '@el-karta/core';
import { Circle } from 'lucide-react';
import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore } from '@/model/store';
import { DEFAULT_TOOL, editorStore } from '../editor-store';
import { cancel, deleteSelected, zoomToFit } from './commands';
import { resolveExtensions } from './extension';
import { visibleRect } from './viewport';

const model = generateProject('small');
const floor = Object.values(model.floors)[0]!;
const wall = Object.values(floor.data.walls)[0]!;

beforeEach(() => {
  modelStore.getState().load(model);
  editorStore.getState().openFloor(crypto.randomUUID());
  editorStore.getState().openFloor(floor.id);
  editorStore.getState().setTool(DEFAULT_TOOL);
  editorStore.getState().setSize({ width: 800, height: 600 });
});

describe('editor commands', () => {
  it('cancel stops drawing first, then clears the selection, then returns to the default tool', () => {
    const editor = () => editorStore.getState();
    editor().setTool('wall');
    editor().select([{ collection: 'walls', id: wall.id }]);
    editor().setDrawing({ points: [{ x: 0, y: 0 }], hover: null });

    cancel();
    expect(editor()).toMatchObject({ drawing: null, tool: 'wall' });
    expect(editor().selection).toHaveLength(1);
    cancel();
    expect(editor()).toMatchObject({ selection: [], tool: 'wall' });
    cancel();
    expect(editor().tool).toBe(DEFAULT_TOOL);
  });

  it('deletes the selection as one undoable edit and clears it', () => {
    editorStore.getState().select([{ collection: 'walls', id: wall.id }]);
    deleteSelected(floor.id);
    expect(modelStore.getState().model?.floors[floor.id]?.data.walls[wall.id]).toBeUndefined();
    expect(editorStore.getState().selection).toEqual([]);
    modelStore.getState().undo();
    expect(modelStore.getState().model?.floors[floor.id]?.data.walls[wall.id]).toEqual(wall);
  });

  it('zooms to the union of the bounds the layer content reports', () => {
    const registry = resolveExtensions([
      {
        id: 'base',
        tools: [{ id: DEFAULT_TOOL, label: 'canvas.tools.select', icon: Circle, order: 0 }],
        layers: [
          {
            id: 'a',
            layer: 'walls',
            order: 0,
            Component: () => null,
            bounds: () => ({ minX: 0, minY: 0, maxX: 10, maxY: 5 }),
          },
          {
            id: 'b',
            layer: 'grid',
            order: 0,
            Component: () => null,
            bounds: () => ({ minX: -20, minY: 2, maxX: -10, maxY: 30 }),
          },
          { id: 'c', layer: 'overlays', order: 0, Component: () => null },
        ],
      },
    ]);
    zoomToFit(floor.id, registry);
    const { viewport, size } = editorStore.getState();
    const visible = visibleRect(viewport, size);
    expect(visible.minX).toBeLessThanOrEqual(-20);
    expect(visible.maxX).toBeGreaterThanOrEqual(10);
    expect(visible.minY).toBeLessThanOrEqual(0);
    expect(visible.maxY).toBeGreaterThanOrEqual(30);
  });
});
