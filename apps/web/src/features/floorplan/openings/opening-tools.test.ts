import type { Opening, Pt } from '@el-karta/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import { pointer, projectWith, pt, testCtx, wall } from '../walls/test-fixtures';
import { openingSlide } from './opening-handle';
import { doorTool, passageTool, windowTool } from './opening-tools';
import { openingsStore } from './openings-store';

let floorId = '';

const openings = () => Object.values(modelStore.getState().model!.floors[floorId]!.data.openings);
const ctx = (): CanvasContext => testCtx(floorId);

beforeEach(() => {
  const project = projectWith([
    wall(pt(0, 0), pt(4, 0), 0.2, 'w'),
    wall(pt(0, 3), pt(0.5, 3), 0.2, 'short'),
  ]);
  floorId = project.floorId;
  modelStore.getState().load(project.model, { discardUnsaved: true });
  editorStore.getState().openFloor(floorId);
  editorStore.getState().select([]);
  openingsStore.setState({ preview: null, drag: null, notice: null });
});

describe('opening tools', () => {
  it('place a door where the wall is tapped, as one undo step', () => {
    doorTool.onTap!(pointer(pt(2, 0.15)), ctx());
    expect(openings()).toEqual([
      expect.objectContaining({
        wallId: 'w',
        kind: 'door',
        offset: 1.55,
        width: 0.9,
        height: 2.1,
        hinge: 'left',
        swing: 'out',
      }),
    ]);
    modelStore.getState().undo();
    expect(openings()).toEqual([]);
    modelStore.getState().redo();
    expect(openings()).toHaveLength(1);
  });

  it('place windows with a sill and passages without, nudged off each other', () => {
    windowTool.onTap!(pointer(pt(2, -0.1)), ctx());
    passageTool.onTap!(pointer(pt(2, -0.1)), ctx());
    const [window, passage] = openings() as [Opening, Opening];
    expect(window).toMatchObject({ kind: 'window', offset: 1.4, sill: 0.9 });
    expect(passage).toMatchObject({ kind: 'passage' });
    expect(passage.offset).toBeCloseTo(2.6);
  });

  it('preview on hover and clear the preview when the pointer leaves', () => {
    doorTool.onHover!(pointer(pt(3, 0.05)), ctx());
    expect(openingsStore.getState().preview).toMatchObject({
      floorId,
      opening: { wallId: 'w', offset: 2.55 },
    });
    expect(openings()).toEqual([]);
    doorTool.onHover!(pointer(pt(3, 2)), ctx());
    expect(openingsStore.getState().preview).toBeNull();
    doorTool.onHover!(pointer(pt(3, 0.05)), ctx());
    doorTool.onLeave!(ctx());
    expect(openingsStore.getState().preview).toBeNull();
  });

  it('refuse with a notice away from walls and on a wall shorter than the opening', () => {
    doorTool.onTap!(pointer(pt(2, 1.5)), ctx());
    expect(openingsStore.getState().notice).toBe('openings.notOnWall');
    windowTool.onTap!(pointer(pt(0.25, 3)), ctx());
    expect(openingsStore.getState().notice).toBe('openings.tooShort');
    expect(openings()).toEqual([]);
    doorTool.onDeactivate!(ctx());
    expect(openingsStore.getState().notice).toBeNull();
  });

  it('select an existing opening instead of placing another on it', () => {
    doorTool.onTap!(pointer(pt(2, 0)), ctx());
    const placed = openings()[0]!;
    const onIt: CanvasContext = {
      ...ctx(),
      itemAt: () => ({ collection: 'openings', id: placed.id }),
    };
    doorTool.onTap!(pointer(pt(2, 0)), onIt);
    expect(openings()).toHaveLength(1);
    expect(editorStore.getState().selection).toEqual([{ collection: 'openings', id: placed.id }]);
  });
});

describe('sliding an opening', () => {
  const drag = (id: string, from: Pt, to: Pt[], end = true) => {
    openingSlide.onDragStart!({ id }, pointer(from), pointer(from), ctx());
    for (const p of to) openingSlide.onDrag({ id }, pointer(p), ctx());
    if (end) openingSlide.onDragEnd!({ id }, pointer(to.at(-1)!), ctx());
  };

  it('previews the move, then commits it as one undo step', () => {
    doorTool.onTap!(pointer(pt(1, 0)), ctx());
    const door = openings()[0]!;
    drag(door.id, pt(1, 0), [pt(1.5, 0.3), pt(2, 0.3)], false);
    expect(openingsStore.getState().drag?.opening.offset).toBeCloseTo(1.55);
    expect(openings()[0]!.offset).toBeCloseTo(0.55);
    openingSlide.onDragEnd!({ id: door.id }, pointer(pt(2, 0.3)), ctx());
    expect(openingsStore.getState().drag).toBeNull();
    expect(openings()[0]!.offset).toBeCloseTo(1.55);
    expect(modelStore.getState().past).toHaveLength(2);
    modelStore.getState().undo();
    expect(openings()[0]!.offset).toBeCloseTo(0.55);
  });

  it('stops at the wall end and beside other openings', () => {
    doorTool.onTap!(pointer(pt(1, 0)), ctx());
    windowTool.onTap!(pointer(pt(3, 0)), ctx());
    const door = openings().find((o) => o.kind === 'door')!;
    drag(door.id, pt(1, 0), [pt(-2, 0)]);
    expect(openings().find((o) => o.id === door.id)!.offset).toBe(0);
    drag(door.id, pt(0.45, 0), [pt(2.6, 0)]);
    expect(openings().find((o) => o.id === door.id)!.offset).toBeCloseTo(1.5);
  });

  it('leaves the model alone when cancelled or not moved', () => {
    doorTool.onTap!(pointer(pt(1, 0)), ctx());
    const door = openings()[0]!;
    drag(door.id, pt(1, 0), [pt(3, 0)], false);
    openingSlide.onDragCancel!({ id: door.id }, ctx());
    expect(openingsStore.getState().drag).toBeNull();
    drag(door.id, pt(1, 0), [pt(1, 0.5)]);
    expect(openings()[0]).toEqual(door);
    expect(modelStore.getState().past).toHaveLength(1);
  });
});
