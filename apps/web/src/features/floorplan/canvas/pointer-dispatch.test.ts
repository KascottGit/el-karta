import { Circle } from 'lucide-react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TOOL, editorStore } from '../editor-store';
import {
  resolveExtensions,
  type CanvasContext,
  type CanvasPointer,
  type Handle,
  type Tool,
} from './extension';
import type { PointerKind } from './gestures';
import { createPointerDispatch } from './pointer-dispatch';
import { pointerFixtures } from './pointer-fixtures';

const calls: string[] = [];
const at = (p: CanvasPointer) => `${p.world.x},${p.world.y}`;

const vertex: Handle<{ index: number }> = {
  name: 'vertex',
  onDragStart: ({ index }, start, p) => calls.push(`handle ${index} start ${at(start)}→${at(p)}`),
  onDrag: ({ index }, p) => calls.push(`handle ${index} drag ${at(p)}`),
  onDragEnd: ({ index }, p) => calls.push(`handle ${index} end ${at(p)}`),
  onDragCancel: ({ index }) => calls.push(`handle ${index} cancel`),
};

const tool = (id: string, drags: boolean): Tool => ({
  id,
  label: 'canvas.tools.select',
  icon: Circle,
  order: 0,
  onTap: (p) => calls.push(`${id} tap ${at(p)}${p.onHandle ? ' on handle' : ''}`),
  onDragStart: () => drags,
  onDrag: (p) => calls.push(`${id} drag ${at(p)}`),
  onDragEnd: (p) => calls.push(`${id} end ${at(p)}`),
  onDragCancel: () => calls.push(`${id} cancel`),
  onLeave: () => calls.push(`${id} leave`),
});

const registry = resolveExtensions([
  { id: 'test', tools: [tool(DEFAULT_TOOL, false), tool('draw', true)], handles: [vertex] },
]);
const ctx: CanvasContext = {
  floorId: crypto.randomUUID(),
  itemAt: () => null,
  pxToWorld: (px) => px,
  zoomToFit: () => {},
};

/** A 10 × 10 px handle at the origin; touch finds it from further away, as `handleAt` does. */
function setup() {
  const lookups: PointerKind[] = [];
  const dispatch = createPointerDispatch({
    registry,
    ctx,
    handleAt: (screen, kind) => {
      lookups.push(kind);
      const reach = kind === 'touch' ? 22 : 10;
      return screen.x < reach && screen.y < reach
        ? { handle: registry.handles.get('vertex')!, payload: { index: 7 } }
        : null;
    },
  });
  return { dispatch, lookups, ...pointerFixtures() };
}

beforeEach(() => {
  calls.length = 0;
  editorStore.getState().setTool(DEFAULT_TOOL);
  editorStore.getState().setViewport({ x: 0, y: 0, scale: 1 });
});

describe('pointer dispatch', () => {
  it('sends a drag that starts on a handle to the handle, with world positions, without panning', () => {
    const { dispatch, mouse } = setup();
    dispatch.down(mouse(5, 5));
    dispatch.move(mouse(20, 5));
    dispatch.move(mouse(30, 8));
    dispatch.up(mouse(30, 8));
    expect(calls).toEqual([
      'handle 7 start 5,5→20,5',
      'handle 7 drag 20,5',
      'handle 7 drag 30,8',
      'handle 7 end 30,8',
    ]);
    expect(editorStore.getState().viewport).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('gives the handle the drag even when the active tool takes drags', () => {
    const { dispatch, mouse } = setup();
    editorStore.getState().setTool('draw');
    dispatch.down(mouse(5, 5));
    dispatch.move(mouse(20, 5));
    dispatch.up(mouse(20, 5));
    dispatch.down(mouse(50, 50));
    dispatch.move(mouse(60, 50));
    dispatch.up(mouse(60, 50));
    expect(calls).toEqual([
      'handle 7 start 5,5→20,5',
      'handle 7 drag 20,5',
      'handle 7 end 20,5',
      'draw drag 60,50',
      'draw end 60,50',
    ]);
  });

  it('passes a tap on a handle to the tool, marked so the select tool can ignore it', () => {
    const { dispatch, mouse } = setup();
    dispatch.down(mouse(5, 5));
    dispatch.up(mouse(5, 5));
    dispatch.down(mouse(100, 100));
    dispatch.up(mouse(100, 100));
    expect(calls).toEqual(['select tap 5,5 on handle', 'select tap 100,100']);
  });

  it('pans when a drag misses every handle and the tool does not take it', () => {
    const { dispatch, mouse } = setup();
    dispatch.down(mouse(50, 50));
    dispatch.move(mouse(70, 60));
    dispatch.up(mouse(70, 60));
    expect(calls).toEqual([]);
    expect(editorStore.getState().viewport).toEqual({ x: 20, y: 10, scale: 1 });
  });

  it('looks handles up with the pointer kind, so touch gets a larger reach', () => {
    const { dispatch, touch, lookups } = setup();
    dispatch.down(touch(1, 18, 18));
    dispatch.move(touch(1, 40, 18));
    dispatch.up(touch(1, 40, 18));
    expect(lookups).toEqual(['touch']);
    expect(calls).toEqual([
      'handle 7 start 18,18→40,18',
      'handle 7 drag 40,18',
      'handle 7 end 40,18',
    ]);
  });

  it('does not look for handles when panning with the middle button or Space', () => {
    const { dispatch, mouse, lookups } = setup();
    dispatch.down(mouse(5, 5, { button: 1, buttons: 4 }));
    dispatch.move(mouse(25, 5, { buttons: 4 }));
    dispatch.up(mouse(25, 5, { button: 1 }));
    expect(lookups).toEqual([]);
    expect(editorStore.getState().viewport.x).toBe(20);
  });

  it('cancels a handle drag on a second finger, on Escape and on cleanup', () => {
    const { dispatch, mouse, touch } = setup();
    dispatch.down(touch(1, 5, 5));
    dispatch.move(touch(1, 30, 5));
    dispatch.down(touch(2, 200, 200));
    dispatch.up(touch(2, 200, 200));
    dispatch.up(touch(1, 30, 5));

    dispatch.down(mouse(5, 5));
    dispatch.move(mouse(20, 5));
    expect(dispatch.cancelDrag()).toBe(true);
    dispatch.move(mouse(40, 5));
    dispatch.up(mouse(40, 5));

    dispatch.down(mouse(5, 5));
    dispatch.move(mouse(20, 5));
    dispatch.cancelDrag();
    expect(dispatch.cancelDrag()).toBe(false);

    expect(calls).toEqual([
      'handle 7 start 5,5→30,5',
      'handle 7 drag 30,5',
      'handle 7 cancel',
      'handle 7 start 5,5→20,5',
      'handle 7 drag 20,5',
      'handle 7 cancel',
      'handle 7 start 5,5→20,5',
      'handle 7 drag 20,5',
      'handle 7 cancel',
    ]);
  });

  it('cancels a tool drag the same way, and tells the tool when a mouse leaves', () => {
    const { dispatch, mouse, touch } = setup();
    editorStore.getState().setTool('draw');
    dispatch.down(mouse(50, 50));
    dispatch.move(mouse(60, 50));
    dispatch.cancelDrag();
    dispatch.up(mouse(60, 50));
    dispatch.leave(mouse(-1, 50, { buttons: 0 }));
    dispatch.leave(touch(3, -1, 50));
    expect(calls).toEqual(['draw drag 60,50', 'draw cancel', 'draw leave']);
  });
});
