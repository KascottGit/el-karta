import { Matrix, SVD } from 'ml-matrix';

export interface XY {
  x: number;
  y: number;
}

/** An image point and where it is on the wall plane (`x` = u, `y` = v). */
export interface Correspondence {
  image: XY;
  plane: XY;
}

/** A fitted image → plane mapping (row-major 3×3). */
export interface Homography {
  h: readonly number[];
  /** The sign of the homogeneous `w` at the fit points; a point with the other sign lies beyond the horizon. */
  sign: 1 | -1;
}

export const MIN_FIT_POINTS = 4;

/**
 * Whether the points fail to fix a homography: fewer than 4 distinct, or all but at most one on a
 * line (within `tolerance`), as with only floor-level points.
 */
export function degenerate(points: readonly XY[], tolerance: number): boolean {
  const distinct: XY[] = [];
  for (const p of points) {
    if (!distinct.some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= tolerance)) distinct.push(p);
  }
  const n = distinct.length;
  if (n < MIN_FIT_POINTS) return true;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = distinct[i]!;
      const b = distinct[j]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const onLine = distinct.filter(
        (p) => Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len <= tolerance,
      ).length;
      if (onLine >= n - 1) return true;
    }
  }
  return false;
}

/** Translation and scale that move the points' centroid to 0 and their mean distance to √2 (Hartley). */
function normaliser(points: readonly XY[]) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const mean = points.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / points.length;
  const s = mean > 0 ? Math.SQRT2 / mean : 1;
  return { cx, cy, s, apply: (p: XY): XY => ({ x: s * (p.x - cx), y: s * (p.y - cy) }) };
}

const PLANE_TOLERANCE = 0.03;
const IMAGE_TOLERANCE = 3;

/**
 * Least-squares direct linear transform from image points (0–1000) to wall-plane metres, over every
 * correspondence, with point normalisation. Null when the points cannot fix one.
 */
export function fitHomography(pairs: readonly Correspondence[]): Homography | null {
  const image = pairs.map((p) => p.image);
  const plane = pairs.map((p) => p.plane);
  if (degenerate(plane, PLANE_TOLERANCE) || degenerate(image, IMAGE_TOLERANCE)) return null;
  const ni = normaliser(image);
  const np = normaliser(plane);

  const rows: number[][] = [];
  for (const pair of pairs) {
    const { x, y } = ni.apply(pair.image);
    const { x: u, y: v } = np.apply(pair.plane);
    rows.push([-x, -y, -1, 0, 0, 0, u * x, u * y, u]);
    rows.push([0, 0, 0, -x, -y, -1, v * x, v * y, v]);
  }
  while (rows.length < 9) rows.push(Array<number>(9).fill(0));
  const svd = new SVD(new Matrix(rows));
  const values = svd.diagonal;
  const smallest = values.indexOf(Math.min(...values));
  const hn = svd.rightSingularVectors.getColumn(smallest);

  // H = Np⁻¹ · Hn · Ni
  const ni3 = new Matrix([
    [ni.s, 0, -ni.s * ni.cx],
    [0, ni.s, -ni.s * ni.cy],
    [0, 0, 1],
  ]);
  const npInv = new Matrix([
    [1 / np.s, 0, np.cx],
    [0, 1 / np.s, np.cy],
    [0, 0, 1],
  ]);
  const h = npInv
    .mmul(Matrix.from1DArray(3, 3, hn))
    .mmul(ni3)
    .to1DArray();
  if (!h.every(Number.isFinite)) return null;

  const signs = image.map((p) => Math.sign(h[6]! * p.x + h[7]! * p.y + h[8]!));
  const sign = signs[0] === -1 ? -1 : 1;
  if (signs.some((s) => s !== sign)) return null;
  return { h, sign };
}

/** The plane point an image point maps to, or null when it lies beyond the horizon. */
export function applyHomography(homography: Homography, p: XY): XY | null {
  const { h, sign } = homography;
  const w = h[6]! * p.x + h[7]! * p.y + h[8]!;
  if (w * sign <= 0) return null;
  return {
    x: (h[0]! * p.x + h[1]! * p.y + h[2]!) / w,
    y: (h[3]! * p.x + h[4]! * p.y + h[5]!) / w,
  };
}
