import { describe, expect, it } from 'vitest';
import { cornerAt, fixedEnds, moveEnds, setLength } from './corner';
import { pt, wall } from './test-fixtures';

// An L: top runs (0,0)→(4,0), side runs (4.005,0.005)→(4,3), half a centimetre off the corner.
const top = wall(pt(0, 0), pt(4, 0), 0.2, 'top');
const side = wall(pt(4.005, 0.005), pt(4, 3), 0.2, 'side');
const far = wall(pt(4.02, 0), pt(8, 0), 0.2, 'far');
const walls = { top, side, far };

describe('corners', () => {
  it('are the wall ends within a centimetre of a point', () => {
    expect(cornerAt(walls, pt(4, 0))).toEqual([
      { wallId: 'top', end: 'b' },
      { wallId: 'side', end: 'a' },
    ]);
    expect(cornerAt(walls, pt(10, 10))).toEqual([]);
  });

  it('stay fixed at the far ends of the moving walls', () => {
    expect(fixedEnds(walls, cornerAt(walls, pt(4, 0)))).toEqual([pt(0, 0), pt(4, 3)]);
  });

  it('move together, leaving the other ends and other walls alone', () => {
    const moved = moveEnds(walls, cornerAt(walls, pt(4, 0)), pt(5, -1));
    expect(moved).toEqual([
      { ...top, b: pt(5, -1) },
      { ...side, a: pt(5, -1) },
    ]);
  });

  it('do not move onto the far end of one of their walls', () => {
    expect(moveEnds(walls, cornerAt(walls, pt(4, 0)), pt(0.005, 0))).toBeNull();
  });
});

describe('setLength', () => {
  it('moves end b along the wall, together with its corner', () => {
    const moved = setLength(walls, 'top', 3);
    expect(moved).toEqual([
      { ...top, b: pt(3, 0) },
      { ...side, a: pt(3, 0) },
    ]);
  });

  it('refuses a length below a centimetre or an unknown wall', () => {
    expect(setLength(walls, 'top', 0.001)).toBeNull();
    expect(setLength(walls, 'nope', 2)).toBeNull();
  });
});
