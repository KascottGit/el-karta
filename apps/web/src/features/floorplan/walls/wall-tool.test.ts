import type { Pt } from '@el-karta/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import { finishWalls, wallTool, WALL_TOOL } from './wall-tool';
import { pointer, projectWith, pt, testCtx, wall } from './test-fixtures';
import { WALL_THICKNESS, wallsStore } from './walls-store';
import { setSnapping } from '../snapping/snapping';

const existing = wall(pt(0, 0), pt(4, 0), 0.2, 'existing');
let floorId = '';
let otherFloorId = '';

const walls = (id = floorId) => Object.values(modelStore.getState().model!.floors[id]!.data.walls);
const added = () => walls().filter((w) => w.id !== existing.id);
const drawing = () => editorStore.getState().drawing;
const key = (k: string, extra: { ctrlKey?: boolean } = {}) =>
  wallTool.onKeyDown!(
    { key: k, ctrlKey: false, metaKey: false, shiftKey: false, ...extra } as KeyboardEvent,
    testCtx(floorId),
  );
const tap = (p: Pt, extra = {}) => {
  wallTool.onTap!(pointer(p, extra), testCtx(floorId));
};

beforeEach(() => {
  const project = projectWith([existing]);
  floorId = project.floorId;
  otherFloorId = project.otherFloorId;
  modelStore.getState().load(project.model, { discardUnsaved: true });
  editorStore.getState().openFloor(floorId);
  editorStore.getState().setTool(WALL_TOOL);
  setSnapping(true);
  wallsStore.setState({
    thickness: WALL_THICKNESS.interior,
    drawingFloorId: null,
    snap: null,
    drag: null,
  });
});

describe('wall tool', () => {
  it('adds one wall per segment as a single undo step when double-clicked', () => {
    tap(pt(10, 10));
    tap(pt(13, 10));
    tap(pt(13, 12));
    wallTool.onDoubleTap!(pointer(pt(13, 12)), testCtx(floorId));
    expect(drawing()).toBeNull();
    expect(added().map((w) => [w.a, w.b, w.thickness])).toEqual([
      [pt(10, 10), pt(13, 10), WALL_THICKNESS.interior],
      [pt(13, 10), pt(13, 12), WALL_THICKNESS.interior],
    ]);
    modelStore.getState().undo();
    expect(added()).toEqual([]);
    modelStore.getState().redo();
    expect(added()).toHaveLength(2);
  });

  it('finishes on a tap on the last point, Enter and Escape', () => {
    tap(pt(10, 10));
    tap(pt(12, 10));
    tap(pt(12.05, 10));
    expect(drawing()).toBeNull();
    expect(added()).toHaveLength(1);

    for (const k of ['Enter', 'Escape']) {
      tap(pt(10, 20));
      tap(pt(12, 20));
      expect(key(k)).toBe(true);
      expect(drawing()).toBeNull();
    }
    expect(added()).toHaveLength(3);
    expect(key('Escape')).toBe(false);
  });

  it('closes the loop and finishes on a tap on the first point', () => {
    tap(pt(10, 10));
    tap(pt(13, 10));
    tap(pt(13, 13));
    tap(pt(10.04, 10.03));
    expect(drawing()).toBeNull();
    expect(added().at(-1)?.b).toEqual(pt(10, 10));
    expect(added()).toHaveLength(3);
  });

  it('snaps to existing walls and to 45° steps, unless Alt is held or snapping is off', () => {
    tap(pt(4.05, 0.05));
    expect(drawing()?.points).toEqual([pt(4, 0)]);
    wallTool.onHover!(pointer(pt(4.03, 3)), testCtx(floorId));
    expect(drawing()?.hover).toEqual(pt(4, 3));
    expect(wallsStore.getState().snap?.kind).toBe('angle');
    wallTool.onHover!(pointer(pt(4.03, 3), { altKey: true }), testCtx(floorId));
    expect(drawing()?.hover).toEqual(pt(4.03, 3));
    setSnapping(false);
    wallTool.onHover!(pointer(pt(4.03, 3)), testCtx(floorId));
    expect(drawing()?.hover).toEqual(pt(4.03, 3));
  });

  it('snaps the last corner of a rectangle where steps from the last and first points cross', () => {
    tap(pt(10, 10));
    tap(pt(13, 10));
    tap(pt(13, 12));
    wallTool.onHover!(pointer(pt(10.06, 11.95)), testCtx(floorId));
    expect(drawing()?.hover?.x).toBeCloseTo(10, 9);
    expect(drawing()?.hover?.y).toBeCloseTo(12, 9);
    expect(wallsStore.getState().snap?.targets.map((t) => t.kind)).toEqual(['angle', 'angle']);
  });

  it('gives every wall its own copy of the points', () => {
    tap(pt(10, 10));
    tap(pt(13, 10));
    tap(pt(13, 12));
    const placed = drawing()!.points;
    finishWalls();
    const [first, second] = added();
    expect(first!.b).toEqual(second!.a);
    expect(first!.b).not.toBe(second!.a);
    expect(placed).not.toContain(first!.b);
  });

  it('uses the chosen thickness', () => {
    wallsStore.setState({ thickness: WALL_THICKNESS.exterior });
    tap(pt(10, 10));
    tap(pt(12, 10));
    finishWalls();
    expect(added()[0]?.thickness).toBe(WALL_THICKNESS.exterior);
  });

  it('removes the last point with Backspace or Ctrl+Z while drawing', () => {
    tap(pt(10, 10));
    tap(pt(12, 10));
    tap(pt(12, 12));
    expect(key('Backspace')).toBe(true);
    expect(drawing()?.points).toEqual([pt(10, 10), pt(12, 10)]);
    expect(key('z', { ctrlKey: true })).toBe(true);
    expect(key('Backspace')).toBe(true);
    expect(drawing()).toBeNull();
    expect(key('Backspace')).toBe(false);
    expect(modelStore.getState().past).toHaveLength(0);
  });

  it('commits to the floor the polyline was started on when deactivated by a floor switch', () => {
    tap(pt(10, 10));
    tap(pt(12, 10));
    wallTool.onDeactivate!(testCtx(otherFloorId));
    expect(added()).toHaveLength(1);
    expect(walls(otherFloorId)).toEqual([]);
  });

  it('places the next point where a drag from the last point ends, and pans otherwise', () => {
    const ctx = testCtx(floorId);
    tap(pt(10, 10));
    expect(wallTool.onDragStart!(pointer(pt(15, 15)), pointer(pt(15, 16)), ctx)).toBe(false);
    const start = pointer(pt(10.05, 10), { kind: 'touch' });
    expect(wallTool.onDragStart!(start, pointer(pt(11, 10), { kind: 'touch' }), ctx)).toBe(true);
    wallTool.onDrag!(pointer(pt(12, 10.1), { kind: 'touch' }), ctx);
    expect(drawing()?.hover).toEqual(pt(12, 10));
    wallTool.onDragEnd!(pointer(pt(12, 10.1), { kind: 'touch' }), ctx);
    expect(drawing()?.points).toEqual([pt(10, 10), pt(12, 10)]);
  });

  it('clears the hover and snap marker when the pointer leaves', () => {
    tap(pt(10, 10));
    wallTool.onHover!(pointer(pt(4.02, 0.02)), testCtx(floorId));
    expect(wallsStore.getState().snap?.kind).toBe('endpoint');
    wallTool.onLeave!(testCtx(floorId));
    expect(drawing()?.hover).toBeNull();
    expect(wallsStore.getState().snap).toBeNull();
  });
});
