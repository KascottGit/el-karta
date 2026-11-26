import type { PhotoOutput } from '@el-karta/ai-passes';
import { kitchenFloor } from '../../packages/ai-passes/test/photo/floor.ts';
import type { PhotoFacit } from '../photo/facit.ts';

export { kitchenFloor };

/**
 * A model reply for a photo of the kitchen's top wall (wall A): its floor corners at the photo's
 * left and right edges, so the 4 m face maps to image x 0–1000 and positions are rough. A double
 * outlet at x 250 (1.00 m), a single outlet at x 550 (2.20 m) and a single switch at x 795.
 */
export const wallReply = (): PhotoOutput => ({
  wall: 'A',
  references: [
    { what: 'wall_corner', ref: 'A', corner: 'bottom_left', point: { x: 0, y: 900 } },
    { what: 'wall_corner', ref: 'A', corner: 'bottom_right', point: { x: 1000, y: 900 } },
  ],
  features: [
    {
      deviceType: 'power.outlet',
      wall: 'A',
      box: { xmin: 230, ymin: 800, xmax: 270, ymax: 840 },
      count: 2,
      props: [],
      confidence: 0.9,
      existing: null,
    },
    {
      deviceType: 'power.outlet',
      wall: 'A',
      box: { xmin: 530, ymin: 800, xmax: 570, ymax: 840 },
      count: 1,
      props: [],
      confidence: 0.85,
      existing: null,
    },
    {
      deviceType: 'power.switch',
      wall: 'A',
      box: { xmin: 780, ymin: 500, xmax: 810, ymax: 540 },
      count: null,
      props: [{ name: 'variant', value: 'single' }],
      confidence: 0.9,
      existing: null,
    },
  ],
});

/** The facit for `wallReply`'s photo, with the switch's position measured. */
export function wallFacit(ids: ReturnType<typeof kitchenFloor>['ids']): PhotoFacit {
  return {
    room: ids.kitchen,
    wall: ids.outer,
    devices: [
      { type: 'power.outlet', wall: ids.outer, count: 2 },
      { type: 'power.outlet', wall: ids.outer, count: 1 },
      {
        type: 'power.switch',
        wall: ids.outer,
        props: { variant: 'single' },
        offset: 3.3,
        height: 1.05,
      },
      { type: 'power.ceiling_light', wall: 'ceiling' },
    ],
    notes: 'The ceiling light shows at the top edge; the reply misses it.',
  };
}
