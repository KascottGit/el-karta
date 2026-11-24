import type { Device, FloorRecord, Pt } from '@el-karta/core';
import { ModelBuilder } from '../../../core/test/builder.ts';

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/**
 * A floor with a kitchen (0–4 m) and a hall (4–8 m) side by side, 3 m deep. The kitchen's walls
 * clockwise from the top are `outer`, `shared` (towards the hall), `bottom` and `left`; `loose` is
 * a wall away from both rooms. `outer` has a window 1.00 m wide, `shared` a door into the hall.
 */
export function kitchenFloor() {
  const b = new ModelBuilder();
  const shared = b.wall(0, { x: 4, y: 0 }, { x: 4, y: 3 });
  const outer = b.wall(0, { x: 0, y: 0 }, { x: 4, y: 0 });
  const loose = b.wall(0, { x: 10, y: 0 }, { x: 12, y: 0 });
  const bottom = b.wall(0, { x: 4, y: 3 }, { x: 0, y: 3 });
  const left = b.wall(0, { x: 0, y: 3 }, { x: 0, y: 0 });
  const kitchen = b.room(0, rect(0, 0, 4, 3), { name: 'Kök' });
  const hall = b.room(0, rect(4, 0, 8, 3), { name: 'Hall' });
  const window = b.id();
  const door = b.id();
  const floor = b.floors[0]!;
  floor.data.openings = {
    [window]: {
      id: window,
      wallId: outer.id,
      kind: 'window',
      offset: 1,
      width: 1,
      height: 1.2,
      sill: 0.9,
      provenance: { status: 'manual' },
    },
    [door]: {
      id: door,
      wallId: shared.id,
      kind: 'door',
      offset: 1,
      width: 0.9,
      height: 2.1,
      hinge: 'left',
      swing: 'in',
      provenance: { status: 'manual' },
    },
  };
  const ids = {
    kitchen: kitchen.id,
    hall: hall.id,
    shared: shared.id,
    outer: outer.id,
    loose: loose.id,
    bottom: bottom.id,
    left: left.id,
    window,
    door,
  };
  return { floor: structuredClone(floor) as FloorRecord, ids };
}

/** A power outlet on `wallId` at `offset`, on the face into the kitchen unless `side` says otherwise. */
export const outlet = (
  id: string,
  wallId: string,
  offset = 1,
  side: 'left' | 'right' = 'right',
): Device => ({
  id,
  domain: 'power',
  type: 'outlet',
  label: '',
  placement: { kind: 'wall', wallId, offset, side, height: 0.25 },
  props: {},
  ports: [],
  provenance: { status: 'manual' },
});
