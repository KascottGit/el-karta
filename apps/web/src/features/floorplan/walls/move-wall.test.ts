import {
  applyEdit,
  generateProject,
  putSpaceItem,
  type Id,
  type Pt,
  type Wall,
} from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { putWalls } from './corner';
import { moveWall, planWallMove } from './move-wall';
import { projectWith, pt, wall } from './test-fixtures';

const record = (...walls: Wall[]) => Object.fromEntries(walls.map((w) => [w.id, w]));
const byId = (walls: readonly Wall[] | null) =>
  Object.fromEntries((walls ?? []).map((w) => [w.id, w]));

function expectPt(actual: Pt | undefined, expected: Pt) {
  expect(actual?.x).toBeCloseTo(expected.x, 9);
  expect(actual?.y).toBeCloseTo(expected.y, 9);
}

// The top of a box, running left to right; its left normal points up (y down), so a positive
// offset moves it up and a negative one down.
const top = wall(pt(0, 0), pt(4, 0), 0.2, 'top');

describe('moveWall', () => {
  it('moves a free wall along its left normal', () => {
    expect(moveWall(record(top), 'top', 1)).toEqual([{ ...top, a: pt(0, -1), b: pt(4, -1) }]);
    expect(moveWall(record(top), 'top', -0.5)).toEqual([{ ...top, a: pt(0, 0.5), b: pt(4, 0.5) }]);
  });

  it('is null for an unknown wall or one without length', () => {
    const dot = wall(pt(1, 1), pt(1, 1), 0.2, 'dot');
    expect(moveWall(record(top, dot), 'nope', 1)).toBeNull();
    expect(moveWall(record(top, dot), 'dot', 1)).toBeNull();
  });

  it('stretches the other wall of an L, keeping its direction', () => {
    const side = wall(pt(4, 0), pt(4, 3), 0.2, 'side');
    const moved = byId(moveWall(record(top, side), 'top', -1));
    expect(moved['top']).toEqual({ ...top, a: pt(0, 1), b: pt(4, 1) });
    expect(moved['side']).toEqual({ ...side, a: pt(4, 1) });
  });

  it('stretches both neighbours of a U', () => {
    const left = wall(pt(0, 3), pt(0, 0), 0.2, 'left');
    const right = wall(pt(4, 0), pt(4, 3), 0.2, 'right');
    const bottom = wall(pt(4, 3), pt(0, 3), 0.2, 'bottom');
    const moved = byId(moveWall(record(top, left, right, bottom), 'top', 1));
    expect(Object.keys(moved).sort()).toEqual(['left', 'right', 'top']);
    expect(moved['left']).toEqual({ ...left, b: pt(0, -1) });
    expect(moved['right']).toEqual({ ...right, a: pt(4, -1) });
    expect(moved['top']).toEqual({ ...top, a: pt(0, -1), b: pt(4, -1) });
  });

  it('slides a wall joined at 45° along itself, and the corner with it', () => {
    const slant = wall(pt(4, 0), pt(6, 2), 0.2, 'slant');
    const moved = byId(moveWall(record(top, slant), 'top', -1));
    expect(moved['slant']).toEqual({ ...slant, a: pt(5, 1) });
    expect(moved['top']).toEqual({ ...top, a: pt(0, 1), b: pt(5, 1) });
  });

  it('moves the shared end of a straight continuation by the same offset', () => {
    const next = wall(pt(4, 0), pt(8, 0), 0.2, 'next');
    const moved = byId(moveWall(record(top, next), 'top', 1));
    expect(moved['next']).toEqual({ ...next, a: pt(4, -1) });
    expect(moved['top']).toEqual({ ...top, a: pt(0, -1), b: pt(4, -1) });
  });

  it('follows a perpendicular wall at a corner that also continues straight on', () => {
    const next = wall(pt(4, 0), pt(8, 0), 0.2, 'next');
    const slant = wall(pt(4, 0), pt(6, 2), 0.2, 'slant');
    const moved = byId(moveWall(record(top, next, slant), 'top', -1));
    for (const p of [moved['top']?.b, moved['next']?.a, moved['slant']?.a]) expectPt(p, pt(5, 1));
  });

  it('slides walls that end on its middle (a T onto it) along themselves', () => {
    const stem = wall(pt(2, 3), pt(2, 0), 0.2, 'stem');
    const slanted = wall(pt(1, -1), pt(2, 0), 0.2, 'slanted');
    const moved = byId(moveWall(record(top, stem, slanted), 'top', -1));
    expect(moved['stem']).toEqual({ ...stem, b: pt(2, 1) });
    // From the other side, joined to the stem: its end goes to the same point, keeping the joint.
    expectPt(moved['slanted']?.b, pt(2, 1));
    expect(moved['top']).toEqual({ ...top, a: pt(0, 1), b: pt(4, 1) });
  });

  it('slides its end along a wall it ends on the middle of (a T from it)', () => {
    const host = wall(pt(4, -3), pt(4, 3), 0.2, 'host');
    const moved = byId(moveWall(record(top, host), 'top', 1));
    expect(Object.keys(moved)).toEqual(['top']);
    expect(moved['top']).toEqual({ ...top, a: pt(0, -1), b: pt(4, -1) });
    const slantedHost = wall(pt(3, -1), pt(5, 1), 0.2, 'host');
    const slid = byId(moveWall(record(top, slantedHost), 'top', -1));
    expectPt(slid['top']?.b, pt(5, 1));
  });

  it('is null when a neighbour would get too short or turn around', () => {
    const side = wall(pt(4, 0), pt(4, 3), 0.2, 'side');
    expect(moveWall(record(top, side), 'top', -2.995)).toBeNull();
    expect(moveWall(record(top, side), 'top', -4)).toBeNull();
    expect(moveWall(record(top, side), 'top', -2.9)).not.toBeNull();
  });

  it('is null when the moved wall itself would close up between converging neighbours', () => {
    // A trapezoid's top between two walls leaning in: moving it 2 m down closes it to a point.
    const left = wall(pt(0, 0), pt(2, 2), 0.2, 'left');
    const right = wall(pt(4, 0), pt(2, 2), 0.2, 'right');
    expect(moveWall(record(top, left, right), 'top', -1)).not.toBeNull();
    expect(moveWall(record(top, left, right), 'top', -2)).toBeNull();
  });

  it('leaves openings with their offsets and other walls alone', () => {
    const side = wall(pt(4, 0), pt(4, 3), 0.2, 'side');
    const far = wall(pt(10, 0), pt(10, 3), 0.2, 'far');
    const { model, floorId } = projectWith([top, side, far]);
    const withDoor = applyEdit(
      model,
      putSpaceItem(floorId, 'openings', {
        id: 'door',
        wallId: 'top',
        kind: 'door',
        offset: 1,
        width: 0.9,
        height: 2.1,
        provenance: { status: 'manual' },
      }),
    ).model;
    const moved = moveWall(withDoor.floors[floorId]!.data.walls, 'top', -1)!;
    const next = applyEdit(withDoor, putWalls(floorId, moved)).model.floors[floorId]!.data;
    expect(next.openings['door']).toEqual(withDoor.floors[floorId]!.data.openings['door']);
    expect(next.walls['far']).toBe(withDoor.floors[floorId]!.data.walls['far']);
    expect(next.walls['side']?.a).toEqual(pt(4, 1));
  });

  it('plans a move on the large synthetic project quickly', () => {
    const project = generateProject('large');
    const floor = Object.values(project.floors).reduce((a, b) =>
      Object.keys(b.data.walls).length > Object.keys(a.data.walls).length ? b : a,
    );
    const walls = floor.data.walls;
    const ids: Id[] = Object.keys(walls).slice(0, 50);
    const start = performance.now();
    for (const id of ids) {
      const plan = planWallMove(walls, id);
      expect(plan).not.toBeNull();
    }
    const perPlan = (performance.now() - start) / ids.length;
    process.stdout.write(
      `planWallMove on ${Object.keys(walls).length} walls: ${perPlan.toFixed(2)} ms\n`,
    );
    expect(perPlan).toBeLessThan(16);
  });
});
