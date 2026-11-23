import type { Pt } from '@el-karta/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import { setSnapping } from '../snapping/snapping';
import { pointer, projectWith, pt, testCtx, wall } from '../walls/test-fixtures';
import { openingEdgeHandle, openingSlide } from './opening-handle';
import { doorTool } from './opening-tools';
import { openingsStore } from './openings-store';
import type { OpeningEdge } from './resize';

let floorId = '';

const openings = () => Object.values(modelStore.getState().model!.floors[floorId]!.data.openings);

function dragEdge(id: string, edge: OpeningEdge, from: Pt, to: Pt[], end = true, altKey = false) {
  const ctx = testCtx(floorId);
  const payload = { id, edge };
  openingEdgeHandle.onDragStart!(payload, pointer(from), pointer(from), ctx);
  for (const p of to) openingEdgeHandle.onDrag(payload, pointer(p, { altKey }), ctx);
  if (end) openingEdgeHandle.onDragEnd!(payload, pointer(to.at(-1)!, { altKey }), ctx);
}

beforeEach(() => {
  const project = projectWith([wall(pt(0, 0), pt(4, 0), 0.2, 'w')]);
  floorId = project.floorId;
  modelStore.getState().load(project.model, { discardUnsaved: true });
  editorStore.getState().openFloor(floorId);
  openingsStore.setState({ preview: null, drag: null, notice: null });
  setSnapping(true);
  // A door from 0.55 to 1.45 m along the wall.
  doorTool.onTap!(pointer(pt(1, 0)), testCtx(floorId));
});

describe('opening edge handle', () => {
  it('previews a wider opening, then commits it as one undo step', () => {
    const door = openings()[0]!;
    dragEdge(door.id, 'end', pt(1.45, 0.1), [pt(1.8, 0.3), pt(2.05, 0.3)], false);
    expect(openingsStore.getState().drag?.opening).toMatchObject({ offset: 0.55, width: 1.5 });
    expect(openings()[0]).toEqual(door);
    openingEdgeHandle.onDragEnd!(
      { id: door.id, edge: 'end' },
      pointer(pt(2.05, 0.3)),
      testCtx(floorId),
    );
    expect(openingsStore.getState().drag).toBeNull();
    expect(openings()[0]).toMatchObject({ offset: 0.55, width: 1.5 });
    expect(modelStore.getState().past).toHaveLength(2);
    modelStore.getState().undo();
    expect(openings()[0]).toEqual(door);
  });

  it('keeps the far edge when the near edge is dragged, and follows where it was grabbed', () => {
    const door = openings()[0]!;
    dragEdge(door.id, 'start', pt(0.6, 0), [pt(0.25, 0)]);
    const moved = openings()[0]!;
    expect(moved.offset).toBeCloseTo(0.2);
    expect(moved.offset + moved.width).toBeCloseTo(1.45);
  });

  it('rounds to whole centimetres while snapping is on, unless Alt is held', () => {
    const door = openings()[0]!;
    dragEdge(door.id, 'end', pt(1.45, 0), [pt(1.8333, 0)]);
    expect(openings()[0]!.width).toBe(1.28);
    dragEdge(door.id, 'end', pt(1.83, 0), [pt(1.8333, 0)], true, true);
    expect(openings()[0]!.width).toBeCloseTo(1.2833);
    setSnapping(false);
    dragEdge(door.id, 'end', pt(1.8333, 0), [pt(1.9111, 0)]);
    expect(openings()[0]!.width).toBeCloseTo(1.3611);
  });

  it('leaves the model alone when cancelled or not moved', () => {
    const door = openings()[0]!;
    dragEdge(door.id, 'end', pt(1.45, 0), [pt(3, 0)], false);
    openingEdgeHandle.onDragCancel!({ id: door.id, edge: 'end' }, testCtx(floorId));
    expect(openingsStore.getState().drag).toBeNull();
    dragEdge(door.id, 'end', pt(1.45, 0), [pt(1.45, 0.4)]);
    expect(openings()[0]).toEqual(door);
    expect(modelStore.getState().past).toHaveLength(1);
  });
});

describe('opening slide handle', () => {
  it('rounds the offset to whole centimetres while snapping is on', () => {
    const door = openings()[0]!;
    const ctx = testCtx(floorId);
    openingSlide.onDragStart!({ id: door.id }, pointer(pt(1, 0)), pointer(pt(1, 0)), ctx);
    openingSlide.onDragEnd!({ id: door.id }, pointer(pt(1.3333, 0)), ctx);
    expect(openings()[0]!.offset).toBe(0.88);
  });
});
