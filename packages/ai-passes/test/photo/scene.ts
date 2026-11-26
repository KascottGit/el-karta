import type { NormBox, NormPoint, PhotoInput, PhotoReference } from '../../src/index.ts';
import { reference, onWall, type Camera } from './fixtures.ts';

type Context = Omit<PhotoInput, 'image' | 'earlier'>;

const letter = (i: number) => String.fromCharCode(65 + i);

/**
 * What a perfect model would report: every visible corner of `walls` (by index) and of the openings
 * on them, projected by `cam` from the true room `truth`. Left and right are read off the image, so
 * the scene does not share the pass's idea of which wall end is on the left.
 */
export function references(
  cam: Camera,
  truth: Context,
  walls: readonly number[],
  include: { floor?: boolean; ceiling?: boolean; openings?: boolean } = {},
): PhotoReference[] {
  const { floor = true, ceiling = true, openings = true } = include;
  const out: PhotoReference[] = [];
  const pair = (
    what: PhotoReference['what'],
    ref: string,
    level: 'top' | 'bottom',
    p: NormPoint | null,
    q: NormPoint | null,
  ) => {
    if (!p || !q) {
      return;
    }
    const [l, r] = p.x <= q.x ? [p, q] : [q, p];
    out.push(reference(what, ref, `${level}_left`, l), reference(what, ref, `${level}_right`, r));
  };
  for (const i of walls) {
    const wall = truth.walls[i]!;
    const [start, end] = faceEnds(truth, i);
    if (floor)
      pair(
        'wall_corner',
        letter(i),
        'bottom',
        cam(onWall(wall, start, 0)),
        cam(onWall(wall, end, 0)),
      );
    const ch = truth.room.ceilingHeight;
    if (ceiling)
      pair(
        'wall_corner',
        letter(i),
        'top',
        cam(onWall(wall, start, ch)),
        cam(onWall(wall, end, ch)),
      );
    if (!openings) continue;
    truth.openings.forEach((o, j) => {
      if (o.wallId !== wall.id) return;
      const sill = o.sill ?? 0;
      for (const [level, v] of [
        ['bottom', sill],
        ['top', sill + o.height],
      ] as const)
        pair(
          'opening_corner',
          `O${j + 1}`,
          level,
          cam(onWall(wall, o.offset, v)),
          cam(onWall(wall, o.offset + o.width, v)),
        );
    });
  }
  return out;
}

/** The fixture room's face ends along wall `i` (its inner faces are 0.05 m in from the centre lines). */
function faceEnds(truth: Context, i: number): [number, number] {
  const wall = truth.walls[i]!;
  const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
  const t = wall.thickness / 2;
  return [t, length - t];
}

/** The image box around an 8 cm faceplate centred at `u`, `v` on wall `i`. */
export function deviceBox(cam: Camera, truth: Context, i: number, u: number, v: number): NormBox {
  const wall = truth.walls[i]!;
  const corners = [
    [u - 0.04, v - 0.04],
    [u + 0.04, v - 0.04],
    [u - 0.04, v + 0.04],
    [u + 0.04, v + 0.04],
  ].map(([cu, cv]) => cam(onWall(wall, cu!, cv!)));
  if (corners.some((c) => c === null)) throw new Error('Device not in view');
  const xs = corners.map((c) => c!.x);
  const ys = corners.map((c) => c!.y);
  return {
    xmin: Math.min(...xs),
    ymin: Math.min(...ys),
    xmax: Math.max(...xs),
    ymax: Math.max(...ys),
  };
}
