import { Circle } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL } from '../editor-store';
import {
  CANVAS_LAYERS,
  resolveExtensions,
  type EditorExtension,
  type LayerContent,
  type Tool,
} from './extension';

const Nothing = () => null;
const tool = (id: string, order: number, shortcut?: string): Tool => ({
  id,
  label: 'canvas.tools.select',
  icon: Circle,
  order,
  ...(shortcut ? { shortcut } : {}),
});
const content = (id: string, layer: LayerContent['layer'], order: number): LayerContent => ({
  id,
  layer,
  order,
  Component: Nothing,
});

const base: EditorExtension = {
  id: 'base',
  tools: [tool(DEFAULT_TOOL, 0, 'v')],
  layers: [content('walls', 'walls', 0), content('rooms', 'areas', 0)],
};

describe('resolveExtensions', () => {
  it('orders tools, actions, panels and layer content from every extension', () => {
    const walls: EditorExtension = {
      id: 'walls',
      tools: [tool('wall', 10, 'w')],
      layers: [content('wall-handles', 'overlays', 0), content('wall-preview', 'walls', -1)],
      panels: [{ id: 'wall-panel', order: 5, visible: () => true, Component: Nothing }],
    };
    const grid: EditorExtension = {
      id: 'grid',
      tools: [tool('grid', 5)],
      panels: [{ id: 'grid-panel', order: 1, visible: () => true, Component: Nothing }],
      actions: [{ id: 'fit', label: 'canvas.zoomToFit', icon: Circle, order: 0, run: () => {} }],
    };
    const resolved = resolveExtensions([base, walls, grid]);

    expect(resolved.tools.map((t) => t.id)).toEqual([DEFAULT_TOOL, 'grid', 'wall']);
    expect(resolved.panels.map((p) => p.id)).toEqual(['grid-panel', 'wall-panel']);
    expect(resolved.actions.map((a) => a.id)).toEqual(['fit']);
    expect(Object.keys(resolved.layers)).toEqual([...CANVAS_LAYERS]);
    expect(resolved.layers.walls.map((c) => c.id)).toEqual(['wall-preview', 'walls']);
    expect(resolved.layers.overlays.map((c) => c.id)).toEqual(['wall-handles']);
    expect(resolved.layers.background).toEqual([]);
    expect(resolved.shortcuts.tools).toEqual(
      new Map([
        ['v', DEFAULT_TOOL],
        ['w', 'wall'],
      ]),
    );
  });

  it('falls back to the default tool for an unknown id', () => {
    const resolved = resolveExtensions([base]);
    expect(resolved.tool('gone').id).toBe(DEFAULT_TOOL);
  });

  it('rejects clashing ids and shortcuts, and a missing default tool', () => {
    expect(() => resolveExtensions([base, { id: 'base' }])).toThrow(/extension id "base"/);
    expect(() => resolveExtensions([base, { id: 'x', tools: [tool(DEFAULT_TOOL, 1)] }])).toThrow(
      /tool id/,
    );
    expect(() =>
      resolveExtensions([base, { id: 'x', layers: [content('walls', 'overlays', 0)] }]),
    ).toThrow(/layer content id/);
    expect(() => resolveExtensions([base, { id: 'x', tools: [tool('other', 1, 'v')] }])).toThrow(
      /Shortcut "v"/,
    );
    expect(() => resolveExtensions([{ id: 'x', tools: [tool('other', 1)] }])).toThrow(/default id/);
  });
});
