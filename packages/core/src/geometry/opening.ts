import type { Opening } from '../schemas/index.ts';

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
