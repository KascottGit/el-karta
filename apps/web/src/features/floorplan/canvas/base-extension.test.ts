import { beforeEach, describe, expect, it } from 'vitest';
import { editorStore } from '../editor-store';
import { selectTool } from './base-extension';
import type { CanvasContext, CanvasPointer } from './extension';
import type { SelectionItem } from './selection';

const wall: SelectionItem = { collection: 'walls', id: crypto.randomUUID() };
const opening: SelectionItem = { collection: 'openings', id: crypto.randomUUID() };

const ctxHitting = (hit: SelectionItem | null): CanvasContext => ({
  floorId: crypto.randomUUID(),
  itemAt: () => hit,
  pxToWorld: (px) => px,
  zoomToFit: () => {},
});

const tap = (extra: Partial<CanvasPointer> = {}): CanvasPointer => ({
  world: { x: 0, y: 0 },
  screen: { x: 0, y: 0 },
  kind: 'mouse',
  shiftKey: false,
  altKey: false,
  modKey: false,
  onHandle: false,
  ...extra,
});

const selection = () => editorStore.getState().selection;

beforeEach(() => {
  editorStore.getState().select([wall]);
});

describe('select tool', () => {
  it('selects what is tapped, and clears the selection on empty space', () => {
    selectTool.onTap!(tap(), ctxHitting(opening));
    expect(selection()).toEqual([opening]);
    selectTool.onTap!(tap(), ctxHitting(null));
    expect(selection()).toEqual([]);
  });

  it('toggles with Shift or Ctrl/Cmd and keeps the selection on empty space', () => {
    selectTool.onTap!(tap({ shiftKey: true }), ctxHitting(opening));
    expect(selection()).toEqual([wall, opening]);
    selectTool.onTap!(tap({ modKey: true }), ctxHitting(wall));
    expect(selection()).toEqual([opening]);
    selectTool.onTap!(tap({ shiftKey: true }), ctxHitting(null));
    expect(selection()).toEqual([opening]);
  });

  it('selects a node that is both selectable and a handle', () => {
    selectTool.onTap!(tap({ onHandle: true }), ctxHitting(opening));
    expect(selection()).toEqual([opening]);
  });

  it('keeps the selection when a bare handle is tapped', () => {
    selectTool.onTap!(tap({ onHandle: true }), ctxHitting(null));
    expect(selection()).toEqual([wall]);
  });
});
