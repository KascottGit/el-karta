import { toAnthropicSchema } from '@el-karta/ai-providers';
import type { PhotoDetectable } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { deviceTypeKey, PhotoInput, PhotoOutput } from '../../src/index.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const outlet: PhotoDetectable = {
  domain: 'power',
  type: 'outlet',
  description: 'Wall socket outlet',
  placement: 'wall',
  defaultHeight: 0.25,
  countable: true,
  ports: [{ kind: 'power-in', domain: 'power' }],
};

const input = (detectable: PhotoDetectable[] = [outlet]) => ({
  image: { mimeType: 'image/jpeg', data: 'AAAA' },
  earlier: [],
  room: {
    id: id(1),
    name: 'Kök',
    type: 'kitchen',
    polygon: [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
    ],
    ceilingHeight: 2.5,
  },
  walls: [{ id: id(2), a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, thickness: 0.1, side: 'right' }],
  targetWallId: id(2),
  openings: [
    { id: id(3), wallId: id(2), kind: 'window', offset: 1, width: 1, height: 1.2, sill: 0.9 },
  ],
  devices: [
    {
      id: id(4),
      domain: 'power',
      type: 'outlet',
      placement: { kind: 'wall', wallId: id(2), offset: 0.5, height: 0.25, side: 'right' },
    },
  ],
  detectable,
});

describe('photo schemas', () => {
  it('accepts the detectable types core builds from the plugins', () => {
    expect(PhotoInput.safeParse(input()).success).toBe(true);
    expect(PhotoInput.safeParse(input([])).success).toBe(false);
    expect(
      PhotoInput.safeParse({ ...input(), earlier: Array(4).fill(input().image) }).success,
    ).toBe(false);
  });

  it('names types by domain and type', () => {
    expect(deviceTypeKey(outlet)).toBe('power.outlet');
  });

  it('has an output schema the Anthropic schema transform accepts', () => {
    const schema = z.toJSONSchema(PhotoOutput, { io: 'input' }) as Record<string, unknown>;
    expect(toAnthropicSchema(schema)).toMatchObject({ additionalProperties: false });
    const output: PhotoOutput = {
      wall: 'A',
      references: [
        { what: 'wall_corner', ref: 'A', corner: 'bottom_left', point: { x: 10, y: 900 } },
      ],
      features: [
        {
          deviceType: 'power.outlet',
          wall: 'A',
          box: { xmin: 100, ymin: 700, xmax: 160, ymax: 760 },
          count: 2,
          props: [],
          confidence: 0.9,
          existing: 'E1',
        },
      ],
    };
    expect(PhotoOutput.parse(output)).toEqual(output);
  });
});
