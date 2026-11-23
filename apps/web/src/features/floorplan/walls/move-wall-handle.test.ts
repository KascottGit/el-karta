import type { Pt } from '@el-karta/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import { setSnapping } from '../snapping/snapping';
import { wallMoveHandle } from './move-wall-handle';
import { MOVE_WALL_TOOL, moveWallTool, wallsMovable } from './move-wall-tool';
import { pointer, projectWith, pt, testCtx, wall } from './test-fixtures';
import { wallsStore } from './walls-store';

// A box's top and right side, and a free wall 2 m above the top, parallel to it.
const top = wall(pt(0, 0), pt(4, 0), 0.2, 'top');
const side = wall(pt(4, 0), pt(4, 3), 0.2, 'side');
const above = wall(pt(6, -2), pt(9, -2), 0.2, 'above');
let floorId = '';

const wallsNow = () => modelStore.getState().model!.floors[floorId]!.data.walls;
const payload = { wallId: 'top' };

/** Drags the top wall's handle from `from` through `to`. */
function drag(from: Pt, to: Pt[], end = true) {
  const ctx = testCtx(floorId);
  wallMoveHandle.onDragStart!(payload, pointer(from), pointer(from), ctx);
  for (const p of to) wallMoveHandle.onDrag(payload, pointer(p), ctx);
  if (end) wallMoveHandle.onDragEnd!(payload, pointer(to.at(-1)!), ctx);
}

beforeEach(() => {
  const project = projectWith([top, side, above]);
  floorId = project.floorId;
  modelStore.getState().load(project.model, { discardUnsaved: true });
  editorStore.getState().setTool('select');
  editorStore.getState().select([]);
  wallsStore.setState({ drag: null, snap: null });
  setSnapping(false);
});

describe('wall move handle', () => {
  it('previews the wall and its neighbour without touching the model, and cancels', () => {
    drag(pt(2, 0), [pt(2, 0.5)], false);
    const state = wallsStore.getState().drag;
    expect(state?.kind).toBe('move');
    expect([...state!.moving].sort()).toEqual(['side', 'top']);
    expect(state!.preview).toEqual(
      expect.arrayContaining([
        { ...top, a: pt(0, 0.5), b: pt(4, 0.5) },
        { ...side, a: pt(4, 0.5) },
      ]),
    );
    expect(wallsNow()['top']).toEqual(top);
    wallMoveHandle.onDragCancel!(payload, testCtx(floorId));
    expect(wallsStore.getState().drag).toBeNull();
    expect(modelStore.getState().past).toHaveLength(0);
  });

  it('moves by how far the pointer moved across the wall, not where on the wall it grabbed', () => {
    // Grabbed on the face, 8 cm below the centre line, and dragged 1 m down and sideways.
    drag(pt(1, 0.08), [pt(1.5, 1.08)]);
    expect(wallsNow()['top']).toEqual({ ...top, a: pt(0, 1), b: pt(4, 1) });
    expect(wallsNow()['side']).toEqual({ ...side, a: pt(4, 1) });
  });

  it('commits one undo step', () => {
    drag(pt(2, 0), [pt(2, 0.4), pt(2, 1)]);
    expect(modelStore.getState().past).toHaveLength(1);
    modelStore.getState().undo();
    expect(wallsNow()['top']).toEqual(top);
    expect(wallsNow()['side']).toEqual(side);
  });

  it('snaps so the line passes through a snap target', () => {
    setSnapping(true);
    // Near the line of the parallel wall above, but beside it: its end is the nearest target.
    drag(pt(2, 0.05), [pt(5.95, -1.98)]);
    expect(wallsNow()['top']?.a.y).toBeCloseTo(-2, 9);
    expect(wallsStore.getState().snap).toBeNull();
    setSnapping(false);
    drag(pt(2, -2), [pt(2, -1.97)]);
    expect(wallsNow()['top']?.a.y).toBeCloseTo(-1.97, 9);
  });

  it('ignores a drop that would leave a neighbour without length, and one that went nowhere', () => {
    drag(pt(2, 0), [pt(2, 2.996)]);
    drag(pt(2, 0), [pt(2, 1), pt(2, 0)]);
    expect(modelStore.getState().past).toHaveLength(0);
  });
});

describe('move-wall tool', () => {
  const onWall = { ...testCtx(''), itemAt: () => ({ collection: 'walls' as const, id: 'top' }) };

  it('moves a wall it is dragged on without selecting it first', () => {
    const ctx = { ...onWall, floorId };
    expect(moveWallTool.onDragStart!(pointer(pt(2, 0)), pointer(pt(2, 0.2)), ctx)).toBe(true);
    moveWallTool.onDrag!(pointer(pt(2, -1)), ctx);
    moveWallTool.onDragEnd!(pointer(pt(2, -1)), ctx);
    expect(wallsNow()['top']).toEqual({ ...top, a: pt(0, -1), b: pt(4, -1) });
    expect(editorStore.getState().selection).toEqual([]);
  });

  it('pans when the drag starts off a wall', () => {
    const ctx = testCtx(floorId);
    expect(moveWallTool.onDragStart!(pointer(pt(2, 2)), pointer(pt(2, 2.2)), ctx)).toBe(false);
    expect(wallsStore.getState().drag).toBeNull();
  });

  it('drops the preview when it is switched away from', () => {
    const ctx = { ...onWall, floorId };
    moveWallTool.onDragStart!(pointer(pt(2, 0)), pointer(pt(2, 0.2)), ctx);
    moveWallTool.onDeactivate!(ctx);
    expect(wallsStore.getState().drag).toBeNull();
    expect(wallsNow()['top']).toEqual(top);
  });
});

describe('wallsMovable', () => {
  it('holds for one selected item with the select and move-wall tools while nothing is drawn', () => {
    const state = {
      ...editorStore.getState(),
      selection: [{ collection: 'walls' as const, id: 'top' }],
    };
    expect(wallsMovable(state)).toBe(true);
    expect(wallsMovable({ ...state, selection: [] })).toBe(false);
    expect(
      wallsMovable({
        ...state,
        selection: [...state.selection, { collection: 'walls', id: 'side' }],
      }),
    ).toBe(false);
    expect(wallsMovable({ ...state, tool: MOVE_WALL_TOOL })).toBe(true);
    expect(wallsMovable({ ...state, tool: 'wall' })).toBe(false);
    expect(wallsMovable({ ...state, drawing: { points: [pt(0, 0)], hover: null } })).toBe(false);
  });
});
