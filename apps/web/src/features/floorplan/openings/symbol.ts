import {
  add,
  EPSILON,
  leftNormal,
  normalize,
  scale,
  sub,
  wallLength,
  type Opening,
  type Pt,
  type Wall,
} from '@el-karta/core';

const ARC_STEPS = 16;

/** Flat point lists in world coordinates, ready for Konva `Line`s. */
export interface OpeningSymbol {
  /** The part of the wall the opening takes up, as a closed quad drawn over the wall. */
  gap?: number[];
  /** The part of an opening beyond the wall's end `b`, which the validator flags. */
  overhang?: number[];
  centre: Pt;
  width: number;
  /** A door's leaf, drawn fully open. */
  leaf?: number[];
  /** A door's swing, a quarter circle from the open leaf to the closed position. */
  arc?: number[];
  /** A window's two panes along the wall. */
  panes?: [number[], number[]];
}

const flat = (points: readonly Pt[]) => points.flatMap((p) => [p.x, p.y]);

/** How an opening is drawn in its wall; ADR 0006 says what `hinge` and `swing` mean. Null for a wall without length. */
export function openingSymbol(wall: Wall, opening: Opening): OpeningSymbol | null {
  const length = wallLength(wall);
  if (length < EPSILON) return null;
  const dir = normalize(sub(wall.b, wall.a));
  const normal = leftNormal(dir);
  const half = wall.thickness / 2;
  const start = add(wall.a, scale(dir, opening.offset));
  const end = add(wall.a, scale(dir, opening.offset + opening.width));
  const across = (p: Pt, k: number) => add(p, scale(normal, k));
  const span = (from: number, to: number) => {
    const s = add(wall.a, scale(dir, from));
    const e = add(wall.a, scale(dir, to));
    return flat([across(s, half), across(e, half), across(e, -half), across(s, -half)]);
  };
  const far = opening.offset + opening.width;
  const symbol: OpeningSymbol = {
    centre: scale(add(start, end), 0.5),
    width: opening.width,
  };
  if (opening.offset < length - EPSILON) symbol.gap = span(opening.offset, Math.min(far, length));
  if (far > length + EPSILON) symbol.overhang = span(Math.max(opening.offset, length), far);
  if (opening.kind === 'window') {
    const k = half / 3;
    symbol.panes = [
      flat([across(start, k), across(end, k)]),
      flat([across(start, -k), across(end, -k)]),
    ];
  } else if (opening.kind === 'door') {
    const atStart = opening.hinge !== 'right';
    const towardsOther = atStart ? dir : scale(dir, -1);
    const out = opening.swing === 'out' ? scale(normal, -1) : normal;
    const pivot = add(atStart ? start : end, scale(out, half));
    const r = opening.width;
    const arc: Pt[] = [];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const angle = (i / ARC_STEPS) * (Math.PI / 2);
      arc.push(
        add(pivot, add(scale(out, r * Math.cos(angle)), scale(towardsOther, r * Math.sin(angle)))),
      );
    }
    symbol.leaf = flat([pivot, add(pivot, scale(out, r))]);
    symbol.arc = flat(arc);
  }
  return symbol;
}
