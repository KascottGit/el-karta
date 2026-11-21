import type { FloorplanOutput, LocateOutput } from '@el-karta/ai-passes';

export const locate = (box: LocateOutput['box']): LocateOutput => ({ found: true, box });

/**
 * A model reply for a two-room flat filling the middle of the sent image: a living room and a
 * bedroom split by a wall at x = 600, an entrance door and a bedroom door, printed "Skala 1:100".
 */
export const flat = (partial: Partial<FloorplanOutput> = {}): FloorplanOutput => ({
  walls: [
    { a: { x: 100, y: 100 }, b: { x: 900, y: 100 }, exterior: true, thickness: 15 },
    { a: { x: 900, y: 100 }, b: { x: 900, y: 900 }, exterior: true, thickness: 15 },
    { a: { x: 900, y: 900 }, b: { x: 100, y: 900 }, exterior: true, thickness: 15 },
    { a: { x: 100, y: 900 }, b: { x: 100, y: 100 }, exterior: true, thickness: 15 },
    { a: { x: 600, y: 100 }, b: { x: 600, y: 900 }, exterior: false, thickness: 8 },
  ],
  openings: [
    {
      kind: 'door',
      a: { x: 600, y: 450 },
      b: { x: 600, y: 560 },
      double: false,
      hinge: 'a',
      swingInto: null,
    },
    {
      kind: 'door',
      a: { x: 300, y: 900 },
      b: { x: 430, y: 900 },
      double: false,
      hinge: null,
      swingInto: null,
    },
  ],
  rooms: [
    {
      name: 'Vardagsrum',
      type: 'living_room',
      point: { x: 350, y: 500 },
      box: null,
      area: null,
      outdoor: false,
    },
    {
      name: 'Sovrum',
      type: 'bedroom',
      point: { x: 750, y: 500 },
      box: null,
      area: null,
      outdoor: false,
    },
  ],
  dimensions: [],
  scaleBar: null,
  scaleText: 'Skala 1:100',
  paperSize: null,
  totalArea: null,
  ceilingHeight: null,
  standardObjects: [],
  ...partial,
});
