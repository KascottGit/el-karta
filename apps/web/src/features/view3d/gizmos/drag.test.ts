import {
  applyEdit,
  applyModelPatches,
  type FloorData,
  type Opening,
  type Wall,
} from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { projectWith, wall } from '@/features/floorplan/walls/test-fixtures';
import { FloorFixture, pt } from '../geometry/test-fixtures';
import {
  changeEdit,
  changes,
  MIN_WALL_HEIGHT,
  previewFloor,
  startGizmoDrag,
  type DragOptions,
  type GizmoChange,
} from './drag';
import type { HandleName } from './handles';

const free: DragOptions = { snap: null, round: false };
const along = (v: number) => ({ kind: 'axis', along: v }) as const;
const shift = (x: number, y: number) => ({ kind: 'level', shift: { x, y } }) as const;

const walls = (c: GizmoChange | null) =>
  Object.fromEntries(((c?.collection === 'walls' && c.items) || []).map((w) => [w.id, w]));
const opening = (c: GizmoChange | null): Opening | undefined =>
  c?.collection === 'openings' ? c.items[0] : undefined;

/** An L: `top` along +x from (0, 0) to (4, 0), `side` down from its end. */
function lShape() {
  const f = new FloorFixture(2.5);
  const top = f.wall(pt(0, 0), pt(4, 0));
  const side = f.wall(pt(4, 0), pt(4, 3));
  return { f, top, side };
}

const wallDrag = (data: FloorData, w: Wall, handle: HandleName) =>
  startGizmoDrag(data, { collection: 'walls', id: w.id }, handle)!;

describe('wall gizmo', () => {
  it('moves the wall along its normal with either arrow, its neighbour following', () => {
    const { f, top, side } = lShape();
    for (const handle of ['move-left', 'move-right'] as const) {
      const moved = walls(wallDrag(f.data, top, handle).change(f.data, along(-1), free));
      expect(moved[top.id]).toMatchObject({ a: pt(0, 1), b: pt(4, 1) });
      expect(moved[side.id]).toMatchObject({ a: pt(4, 1), b: pt(4, 3) });
    }
  });

  it('snaps the moved wall’s line through a target within reach', () => {
    const { f, top } = lShape();
    f.wall(pt(2.04, 1), pt(2.04, 3));
    const drag = wallDrag(f.data, top, 'move-left');
    expect(walls(drag.change(f.data, along(-0.95), { snap: 0.1, round: true }))[top.id]?.a.y).toBe(
      1,
    );
    expect(walls(drag.change(f.data, along(-0.95), free))[top.id]?.a.y).toBeCloseTo(0.95);
  });

  it('refuses a move that would leave a neighbour too short', () => {
    const { f, top } = lShape();
    expect(wallDrag(f.data, top, 'move-left').change(f.data, along(-3), free)).toBeNull();
  });

  it('drags a top corner in the floor plane with every wall end there', () => {
    const { f, top, side } = lShape();
    const moved = walls(wallDrag(f.data, top, 'corner-b').change(f.data, shift(0.5, -0.25), free));
    expect(moved[top.id]?.b).toEqual(pt(4.5, -0.25));
    expect(moved[side.id]?.a).toEqual(pt(4.5, -0.25));
    expect(moved[top.id]?.a).toEqual(pt(0, 0));
  });

  it('snaps a dragged corner like 2D, to points and angles from the fixed ends', () => {
    const { f, top } = lShape();
    f.wall(pt(6, 6), pt(8, 6));
    const drag = wallDrag(f.data, top, 'corner-b');
    // Near the far wall's end.
    expect(
      walls(drag.change(f.data, shift(1.95, 6.04), { snap: 0.1, round: true }))[top.id]?.b,
    ).toEqual(pt(6, 6));
    expect(walls(drag.change(f.data, shift(1.95, 6.04), free))[top.id]?.b.x).toBeCloseTo(5.95);
  });

  it('sets the wall height from the drag, rounded with snapping and kept above a minimum', () => {
    const { f, top } = lShape();
    const drag = wallDrag(f.data, top, 'height');
    expect(walls(drag.change(f.data, along(0.3333), { snap: 0.1, round: true }))[top.id]).toEqual({
      ...top,
      height: 2.83,
    });
    expect(walls(drag.change(f.data, along(0.3333), free))[top.id]?.height).toBeCloseTo(2.8333);
    expect(walls(drag.change(f.data, along(-5), free))[top.id]?.height).toBe(MIN_WALL_HEIGHT);
  });

  it('has no opening handles', () => {
    const { f, top } = lShape();
    expect(startGizmoDrag(f.data, { collection: 'walls', id: top.id }, 'slide')).toBeNull();
    expect(startGizmoDrag(f.data, { collection: 'walls', id: 'gone' }, 'height')).toBeNull();
  });
});

/** A 6 m wall with a window from 1 to 2.2 m (sill 0.9, top 2.1) and a door from 4 to 4.9 m. */
function wallWithOpenings() {
  const f = new FloorFixture(2.5);
  const w = f.wall(pt(0, 0), pt(6, 0));
  const win = f.opening(w.id, 'window', 1, 1.2, 1.2, 0.9);
  const door = f.opening(w.id, 'door', 4, 0.9, 2.1);
  return { f, w, win, door };
}

const openingDrag = (data: FloorData, o: Opening, handle: HandleName) =>
  startGizmoDrag(data, { collection: 'openings', id: o.id }, handle)!;

describe('opening gizmo', () => {
  it('slides the opening along its wall, clamped beside its neighbour', () => {
    const { f, win } = wallWithOpenings();
    const drag = openingDrag(f.data, win, 'slide');
    expect(opening(drag.change(f.data, along(0.5), free))).toEqual({ ...win, offset: 1.5 });
    expect(opening(drag.change(f.data, along(-3), free))?.offset).toBe(0);
    expect(opening(drag.change(f.data, along(2.5), free))?.offset).toBeCloseTo(2.8);
  });

  it('moves one edge and keeps the other, rounding to centimetres with snapping', () => {
    const { f, win } = wallWithOpenings();
    const end = openingDrag(f.data, win, 'end').change(f.data, along(0.333), {
      snap: 0.1,
      round: true,
    });
    expect(opening(end)).toEqual({ ...win, width: 1.53 });
    const start = opening(openingDrag(f.data, win, 'start').change(f.data, along(-0.5), free));
    expect(start?.offset).toBeCloseTo(0.5);
    expect(start?.width).toBeCloseTo(1.7);
    // Not past the door.
    const wide = opening(openingDrag(f.data, win, 'end').change(f.data, along(5), free));
    expect(wide?.offset).toBe(1);
    expect(wide?.width).toBeCloseTo(3);
  });

  it('sets the top keeping the sill, and the sill keeping the top', () => {
    const { f, win } = wallWithOpenings();
    const top = opening(openingDrag(f.data, win, 'top').change(f.data, along(0.2), free));
    expect(top?.sill).toBe(0.9);
    expect(top?.height).toBeCloseTo(1.4);
    // Clamped to the wall's height.
    expect(opening(openingDrag(f.data, win, 'top').change(f.data, along(1), free))?.height).toBe(
      1.6,
    );
    const sill = opening(openingDrag(f.data, win, 'sill').change(f.data, along(-0.3), free));
    expect(sill?.sill).toBeCloseTo(0.6);
    expect(sill?.height).toBeCloseTo(1.5);
  });

  it('has no sill handle on a door', () => {
    const { f, door } = wallWithOpenings();
    expect(startGizmoDrag(f.data, { collection: 'openings', id: door.id }, 'sill')).toBeNull();
    expect(startGizmoDrag(f.data, { collection: 'openings', id: door.id }, 'height')).toBeNull();
  });
});

describe('preview and commit', () => {
  it('puts the change into a copy of the floor data, sharing everything else', () => {
    const { f, top, side } = lShape();
    const change = wallDrag(f.data, top, 'move-left').change(f.data, along(-1), free)!;
    const preview = previewFloor(f.data, change);
    expect(preview.walls[top.id]?.a).toEqual(pt(0, 1));
    expect(preview.walls[side.id]?.a).toEqual(pt(4, 1));
    expect(f.data.walls[top.id]?.a).toEqual(pt(0, 0));
    expect(preview.openings).toBe(f.data.openings);
    expect(preview.rooms).toBe(f.data.rooms);
  });

  it('tells whether a change differs from the committed data', () => {
    const { f, win } = wallWithOpenings();
    const drag = openingDrag(f.data, win, 'slide');
    expect(changes(f.data, drag.change(f.data, along(0), free)!)).toBe(false);
    expect(changes(f.data, drag.change(f.data, along(0.3), free)!)).toBe(true);
  });

  it('commits the change as one undoable edit', () => {
    const { model, floorId } = projectWith([
      wall(pt(0, 0), pt(4, 0), 0.2, 'top'),
      wall(pt(4, 0), pt(4, 3), 0.2, 'side'),
    ]);
    const data = model.floors[floorId]!.data;
    const change = startGizmoDrag(data, { collection: 'walls', id: 'top' }, 'move-left')!.change(
      data,
      along(-1),
      free,
    )!;
    const { model: next, inversePatches } = applyEdit(model, changeEdit(floorId, change));
    expect(next.floors[floorId]!.data.walls['top']?.a).toEqual(pt(0, 1));
    expect(next.floors[floorId]!.data.walls['side']?.a).toEqual(pt(4, 1));
    expect(applyModelPatches(next, inversePatches).floors[floorId]!.data.walls).toEqual(data.walls);
  });
});
