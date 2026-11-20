import type { Pt } from '../schemas/index.ts';

export const EPSILON = 1e-9;

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
export const length = (a: Pt): number => Math.hypot(a.x, a.y);
export const distance = (a: Pt, b: Pt): number => length(sub(a, b));

export function normalize(a: Pt): Pt {
  const len = length(a);
  return len < EPSILON ? { x: 0, y: 0 } : scale(a, 1 / len);
}

/** Unit normal pointing to the left of `dir` when walking along it in y-down plan coordinates. */
export const leftNormal = (dir: Pt): Pt => normalize({ x: dir.y, y: -dir.x });
