import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore } from '@/model/store';
import { cornerHandle } from './corner-handle';
import { pointer, projectWith, pt, testCtx, wall } from './test-fixtures';
import { wallsStore } from './walls-store';
import { setSnapping } from '../snapping/snapping';

const top = wall(pt(0, 0), pt(4, 0), 0.2, 'top');
const side = wall(pt(4, 0), pt(4, 3), 0.2, 'side');
const other = wall(pt(10, 0), pt(10, 3), 0.2, 'other');
let floorId = '';

const wallsNow = () => modelStore.getState().model!.floors[floorId]!.data.walls;

function drag(to: { x: number; y: number }[], end = true) {
  const ctx = testCtx(floorId);
  const payload = { wallId: 'top', end: 'b' as const };
  cornerHandle.onDragStart!(payload, pointer(pt(4, 0)), pointer(pt(4, 0)), ctx);
  for (const p of to) cornerHandle.onDrag(payload, pointer(p), ctx);
  if (end) cornerHandle.onDragEnd!(payload, pointer(to.at(-1)!), ctx);
}

beforeEach(() => {
  const project = projectWith([top, side, other]);
  floorId = project.floorId;
  modelStore.getState().load(project.model, { discardUnsaved: true });
  wallsStore.setState({ drag: null, snap: null });
  setSnapping(true);
});

describe('corner handle', () => {
  it('previews the moving walls during the drag and leaves the model alone', () => {
    drag([pt(5, 1)], false);
    const state = wallsStore.getState().drag;
    expect([...state!.moving].sort()).toEqual(['side', 'top']);
    expect(state!.preview).toEqual([
      { ...top, b: pt(5, 1) },
      { ...side, a: pt(5, 1) },
    ]);
    expect(wallsNow()['top']).toEqual(top);
    cornerHandle.onDragCancel!({ wallId: 'top', end: 'b' }, testCtx(floorId));
    expect(wallsStore.getState().drag).toBeNull();
    expect(modelStore.getState().past).toHaveLength(0);
  });

  it('moves every end at the corner as one undo step', () => {
    drag([pt(5, 1), pt(6, 2)]);
    expect(wallsNow()['top']?.b).toEqual(pt(6, 2));
    expect(wallsNow()['side']?.a).toEqual(pt(6, 2));
    expect(wallsStore.getState().drag).toBeNull();
    expect(modelStore.getState().past).toHaveLength(1);
    modelStore.getState().undo();
    expect(wallsNow()['top']).toEqual(top);
    expect(wallsNow()['side']).toEqual(side);
  });

  it('snaps to other walls but not to the walls it moves', () => {
    drag([pt(9.95, 1.5)]);
    expect(wallsNow()['top']?.b).toEqual(pt(10, 1.5));
    // Back near (4, 0), where only the moving walls were: angle steps from both far ends meet there.
    drag([pt(4.05, 0.04)]);
    expect(wallsNow()['top']?.b.x).toBeCloseTo(4, 9);
    expect(wallsNow()['top']?.b.y).toBeCloseTo(0, 9);
  });

  it('ignores a drop that would leave a wall without length', () => {
    drag([pt(0.004, 0.003)]);
    expect(modelStore.getState().past).toHaveLength(0);
  });
});
