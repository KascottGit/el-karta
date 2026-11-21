import type { Opening } from '../schemas/index.ts';

export type OpeningKind = Opening['kind'];
export const OPENING_KINDS: readonly OpeningKind[] = ['door', 'window', 'passage'];

export interface OpeningSize {
  width: number;
  height: number;
  sill?: number;
}

/** Sizes a new opening gets when nothing better is known, whether drawn by hand or detected. */
export const OPENING_DEFAULTS: Readonly<Record<OpeningKind, OpeningSize>> = {
  door: { width: 0.9, height: 2.1 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
  passage: { width: 0.9, height: 2.1 },
};

export interface DoorFacing {
  hinge: NonNullable<Opening['hinge']>;
  swing: NonNullable<Opening['swing']>;
}

/**
 * A new door's hinge and swing for a person on `side` of the wall (relative to a→b): it opens
 * towards them and is hinged on their left as seen from there, whichever way the wall was drawn.
 * See ADR 0006 for what `hinge` and `swing` mean.
 */
export const doorFacing = (side: 'left' | 'right'): DoorFacing =>
  side === 'left' ? { hinge: 'right', swing: 'in' } : { hinge: 'left', swing: 'out' };
