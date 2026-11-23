import type { MarkerShape } from './appearance';

/** The subset of a 2D canvas context a marker path needs; Konva's context has it. */
export interface PathContext {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  closePath(): void;
}

const TRIANGLE = [0, 1, 2].map((n) => {
  const angle = (n * 2 * Math.PI) / 3;
  return [Math.sin(angle), -Math.cos(angle)] as const;
});
const DIAMOND = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
const SQUARE = [
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
] as const;
const CORNERS = { triangle: TRIANGLE, diamond: DIAMOND, square: SQUARE } as const;

/**
 * Adds a closed marker of the given shape centred on (x, y) to the current path, so many markers
 * can be filled and stroked at once. `r` is the radius of the circle the shape fits in.
 */
export function markerSubpath(
  context: PathContext,
  shape: MarkerShape,
  x: number,
  y: number,
  r: number,
) {
  if (shape === 'circle') {
    context.moveTo(x + r, y);
    context.arc(x, y, r, 0, 2 * Math.PI);
  } else {
    CORNERS[shape].forEach(([cx, cy], i) => {
      if (i === 0) context.moveTo(x + cx * r, y + cy * r);
      else context.lineTo(x + cx * r, y + cy * r);
    });
  }
  context.closePath();
}
