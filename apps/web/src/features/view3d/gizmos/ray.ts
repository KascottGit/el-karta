import type { Pt, Vec3 } from '@el-karta/core';

/** A pointer ray in plan coordinates (metres, x right, y down, z up from the floor). `dir` is a unit vector. */
export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

/**
 * Below this squared sine between the ray and an axis (about 1.8°) they count as parallel: the
 * closest point would jump far along the axis for a pixel of pointer movement.
 */
const PARALLEL_SIN2 = 1e-3;

/**
 * Where along the axis through `at` with unit direction `dir` the ray passes closest, as a signed
 * distance from `at` in metres. Null when the ray is about parallel to the axis or the closest
 * point is behind the ray's origin.
 */
export function closestOnAxis(ray: Ray, at: Vec3, dir: Vec3): number | null {
  const w = sub(ray.origin, at);
  const b = dot(ray.dir, dir);
  const denom = 1 - b * b;
  if (denom < PARALLEL_SIN2) return null;
  const d = dot(ray.dir, w);
  const e = dot(dir, w);
  const alongRay = (b * e - d) / denom;
  if (alongRay < 0) return null;
  return (e - b * d) / denom;
}

/** Where the ray meets the horizontal plane at height `z`, or null when it misses it. */
export function hitLevel(ray: Ray, z: number): Pt | null {
  if (Math.abs(ray.dir.z) < 1e-6) return null;
  const s = (z - ray.origin.z) / ray.dir.z;
  if (s < 0) return null;
  return { x: ray.origin.x + ray.dir.x * s, y: ray.origin.y + ray.dir.y * s };
}

/**
 * A three.js world ray as a plan ray on a floor drawn at height `base`: three.js `(x, y, z)` is plan
 * `(x, z, y)` (see `../README.md`), and plan z is measured from the floor.
 */
export const planRay = (
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  base: number,
): Ray => ({
  origin: { x: origin.x, y: origin.z, z: origin.y - base },
  dir: { x: dir.x, y: dir.z, z: dir.y },
});

/** How many metres one CSS pixel covers at `depth` metres in front of a camera with vertical field of view `fov` degrees. */
export const metresPerPixel = (depth: number, fov: number, heightPx: number) =>
  (2 * depth * Math.tan((fov * Math.PI) / 360)) / heightPx;

/** Distance in pixels from `p` to the segment `a`–`b` on screen. */
export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
