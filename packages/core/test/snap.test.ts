import { describe, expect, it } from 'vitest';
import {
  generateProject,
  nearestWall,
  snapPoint,
  type FloorData,
  type Grid,
  type Pt,
} from '../src/index.ts';
import { ModelBuilder } from './builder.ts';

const pt = (x: number, y: number): Pt => ({ x, y });

/** An L of two walls meeting at (4, 0), and a wall from (0, 3) to (4, 3). */
function floor(grid?: Grid): FloorData {
  const b = new ModelBuilder();
  b.wall(0, pt(0, 0), pt(4, 0), 0.2);
  b.wall(0, pt(4, 0), pt(4, 3), 0.2);
  b.wall(0, pt(0, 3), pt(4, 3), 0.1);
  const data = b.build().floors[b.floors[0]!.id]!.data;
  return grid ? { ...data, grid } : data;
}

const wallAt = (data: FloorData, a: Pt) =>
  Object.values(data.walls).find((w) => w.a.x === a.x && w.a.y === a.y)!;

const close = (actual: Pt, expected: Pt) => {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
};

describe('snapPoint', () => {
  it('leaves a point with nothing in reach alone', () => {
    const snap = snapPoint(floor(), pt(2, 1.5), { tolerance: 0.1 });
    expect(snap).toEqual({ point: pt(2, 1.5), kind: 'none', targets: [] });
  });

  it('snaps to the nearest wall end within tolerance', () => {
    const data = floor();
    const snap = snapPoint(data, pt(4.05, 0.04), { tolerance: 0.1 });
    expect(snap.kind).toBe('endpoint');
    expect(snap.point).toEqual(pt(4, 0));
    expect(snap.targets[0]).toMatchObject({ kind: 'endpoint', end: expect.any(String) as string });
  });

  it('catches a wall end anywhere inside a thick corner, even beyond the tolerance', () => {
    const b = new ModelBuilder();
    b.wall(0, pt(0, 0), pt(4, 0), 0.6);
    const data = b.build().floors[b.floors[0]!.id]!.data;
    expect(snapPoint(data, pt(0.2, 0.15), { tolerance: 0.05 }).point).toEqual(pt(0, 0));
  });

  it('snaps to extra points such as the start of the polyline being drawn', () => {
    const snap = snapPoint(floor(), pt(10.03, 10), { tolerance: 0.1, points: [pt(10, 10)] });
    expect(snap).toEqual({ point: pt(10, 10), kind: 'endpoint', targets: [{ kind: 'endpoint' }] });
  });

  it('snaps to a wall midpoint', () => {
    const data = floor();
    const snap = snapPoint(data, pt(2.05, 0.06), { tolerance: 0.1 });
    expect(snap.kind).toBe('midpoint');
    expect(snap.point).toEqual(pt(2, 0));
    expect(snap.targets).toEqual([{ kind: 'midpoint', wallId: wallAt(data, pt(0, 0)).id }]);
  });

  it('projects onto a wall centre line for a T-junction, reaching to the face plus tolerance', () => {
    const data = floor();
    const snap = snapPoint(data, pt(1, 0.18), { tolerance: 0.1 });
    expect(snap.kind).toBe('wall');
    close(snap.point, pt(1, 0));
    expect(snap.targets).toEqual([
      { kind: 'wall', wallId: wallAt(data, pt(0, 0)).id, offset: expect.closeTo(1, 9) as number },
    ]);
    expect(snapPoint(data, pt(1, 0.21), { tolerance: 0.1 }).kind).toBe('none');
  });

  it('does not project beyond a wall end', () => {
    expect(snapPoint(floor(), pt(-0.5, 0.05), { tolerance: 0.1 }).kind).toBe('none');
  });

  it('snaps to angle steps from the previous point, more loosely the farther away', () => {
    const from = pt(10, 10);
    const near = snapPoint(floor(), pt(10.5, 10.04), { tolerance: 0.05, from: [from] });
    expect(near.kind).toBe('angle');
    close(near.point, pt(10.5, 10));
    // 2° off a 45° step, 6 m away: 0.2 m from the ray, beyond the tolerance but within 3°.
    const rad = (47 * Math.PI) / 180;
    const far = snapPoint(floor(), pt(10 + 6 * Math.cos(rad), 10 + 6 * Math.sin(rad)), {
      tolerance: 0.05,
      from: [from],
    });
    expect(far.targets).toEqual([{ kind: 'angle', from, angle: 45 }]);
    expect(far.point.x - from.x).toBeCloseTo(far.point.y - from.y, 9);
    // 5° off is too far.
    const off = (95 * Math.PI) / 180;
    expect(
      snapPoint(floor(), pt(10 + 6 * Math.cos(off), 10 + 6 * Math.sin(off)), {
        tolerance: 0.05,
        from: [from],
      }).kind,
    ).toBe('none');
  });

  it('measures angles from +x towards +y and honours another step', () => {
    const snap = snapPoint(floor(), pt(10.01, 12), {
      tolerance: 0.05,
      from: [pt(10, 10)],
      angleStep: 30,
    });
    expect(snap.targets).toEqual([{ kind: 'angle', from: pt(10, 10), angle: 90 }]);
  });

  it('snaps to grid lines, and to the crossing of two', () => {
    const grid: Grid = {
      xLines: [{ label: 'A', pos: 20 }],
      yLines: [{ label: '1', pos: 20 }],
    };
    const one = snapPoint(floor(grid), pt(20.04, 25), { tolerance: 0.1 });
    expect(one).toEqual({
      point: pt(20, 25),
      kind: 'grid',
      targets: [{ kind: 'grid', axis: 'x', pos: 20, label: 'A' }],
    });
    const both = snapPoint(floor(grid), pt(20.04, 19.95), { tolerance: 0.1 });
    expect(both.point).toEqual(pt(20, 20));
    expect(both.targets.map((t) => t.kind)).toEqual(['grid', 'grid']);
  });

  it('ignores the given walls', () => {
    const data = floor();
    const ignore = new Set(Object.values(data.walls).map((w) => w.id));
    expect(snapPoint(data, pt(4.05, 0.04), { tolerance: 0.1, ignore }).kind).toBe('none');
  });

  describe('priority', () => {
    it('prefers an endpoint over a nearer midpoint, line or crossing', () => {
      const b = new ModelBuilder();
      b.wall(0, pt(0, 0), pt(0.15, 0), 0.05);
      const data = {
        ...b.build().floors[b.floors[0]!.id]!.data,
        grid: { xLines: [{ label: 'A', pos: 0.08 }], yLines: [{ label: '1', pos: 0.01 }] },
      };
      const snap = snapPoint(data, pt(0.08, 0.01), { tolerance: 0.1, from: [pt(0.08, 5)] });
      expect(snap.kind).toBe('endpoint');
      expect(snap.point).toEqual(pt(0.15, 0));
    });

    it('prefers a midpoint over lines', () => {
      const grid: Grid = { xLines: [{ label: 'A', pos: 2.01 }], yLines: [] };
      expect(snapPoint(floor(grid), pt(2.01, 0.05), { tolerance: 0.1 }).kind).toBe('midpoint');
    });

    it('prefers the crossing of an angle ray and a wall over either alone', () => {
      const data = floor();
      const from = pt(1, 6);
      // Drawing straight up from (1, 6) towards the wall at y = 3, slightly off both.
      const snap = snapPoint(data, pt(1.04, 3.06), { tolerance: 0.1, from: [from] });
      close(snap.point, pt(1, 3));
      expect(snap.kind).toBe('wall');
      expect(snap.targets.map((t) => t.kind)).toEqual(['wall', 'angle']);
    });

    it('finds where two angle rays cross, e.g. the fourth corner of a rectangle', () => {
      const snap = snapPoint(floor(), pt(10.07, 8.04), {
        tolerance: 0.1,
        from: [pt(10, 12), pt(6, 8)],
      });
      close(snap.point, pt(10, 8));
      expect(snap.targets.map((t) => t.kind)).toEqual(['angle', 'angle']);
    });

    it('ranks a wall over a grid line over an angle ray when they do not cross', () => {
      const data = floor({ xLines: [], yLines: [{ label: '1', pos: 3.05 }] });
      // Parallel wall (y = 3), grid line (y = 3.05) and horizontal ray from (8, 3.02).
      const all = snapPoint(data, pt(1.3, 3.04), { tolerance: 0.1, from: [pt(8, 3.02)] });
      expect(all.kind).toBe('wall');
      close(all.point, pt(1.3, 3));
      const noWall = snapPoint(data, pt(6, 3.04), { tolerance: 0.1, from: [pt(8, 3.02)] });
      expect(noWall.kind).toBe('grid');
      close(noWall.point, pt(6, 3.05));
    });

    it('ignores a crossing farther away than both captures together', () => {
      // A wall at a shallow angle to grid line y = 20 crosses it 10 m from the cursor.
      const b = new ModelBuilder();
      b.wall(0, pt(10, 19.9), pt(30, 20.3), 0.1);
      const data = {
        ...b.build().floors[b.floors[0]!.id]!.data,
        grid: { xLines: [], yLines: [{ label: '1', pos: 20 }] },
      };
      const snap = snapPoint(data, pt(25, 20.1), { tolerance: 0.1 });
      expect(snap.targets.map((t) => t.kind)).toEqual(['wall']);
      expect(snap.point.x).toBeCloseTo(25, 1);
    });
  });

  it('takes well under a millisecond per pointer move on the busiest large floor', () => {
    const model = generateProject('large');
    const data = Object.values(model.floors).reduce((a, b) =>
      Object.keys(b.data.walls).length > Object.keys(a.data.walls).length ? b : a,
    ).data;
    const runs = 2000;
    const start = performance.now();
    for (let i = 0; i < runs; i++) {
      snapPoint(data, pt((i * 37) % 50, (i * 53) % 40), {
        tolerance: 0.2,
        from: [pt(10, 10)],
        points: [pt(0, 0), pt(5, 5)],
      });
    }
    const perMove = (performance.now() - start) / runs;
    expect(perMove).toBeLessThan(1);
  });
});

describe('nearestWall', () => {
  it('gives the offset from end a, the distance and the side', () => {
    const data = floor();
    const top = wallAt(data, pt(0, 0));
    expect(nearestWall(data, pt(1.5, -0.3), 0.5)).toEqual({
      wallId: top.id,
      offset: 1.5,
      distance: expect.closeTo(0.3, 9) as number,
      side: 'left',
    });
    expect(nearestWall(data, pt(1.5, 0.3), 0.5)).toMatchObject({ wallId: top.id, side: 'right' });
  });

  it('counts the tolerance from the wall face, so a tap inside a thick wall hits it', () => {
    const data = floor();
    const top = wallAt(data, pt(0, 0)).id;
    expect(nearestWall(data, pt(1, 0.05), 0)).toMatchObject({ wallId: top, side: 'right' });
    expect(nearestWall(data, pt(1, 0.25), 0.16)?.wallId).toBe(top);
    expect(nearestWall(data, pt(1, 0.25), 0.16)?.distance).toBeCloseTo(0.25, 9);
    expect(nearestWall(data, pt(1, 0.25), 0.14)).toBeNull();
  });

  it('clamps the offset to the wall and measures past its ends', () => {
    const data = floor();
    const hit = nearestWall(data, pt(-0.1, 0), 0.2);
    expect(hit).toMatchObject({ wallId: wallAt(data, pt(0, 0)).id, offset: 0 });
    expect(hit?.distance).toBeCloseTo(0.1, 9);
  });

  it('picks the nearer of two walls and returns null when none is in reach', () => {
    const data = floor();
    expect(nearestWall(data, pt(3.8, 1), 0.3)?.wallId).toBe(wallAt(data, pt(4, 0)).id);
    expect(nearestWall(data, pt(2, 1.5), 0.3)).toBeNull();
  });
});
