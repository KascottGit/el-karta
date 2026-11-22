import { describe, expect, it } from 'vitest';
import {
  planTiles,
  readFloorplan,
  type FloorplanInput,
  type PlanImage,
  type ReadProgress,
  type Tile,
} from '../../src/index.ts';
import { located, output, page } from './fixtures.ts';

const image = (width: number, height: number): PlanImage => ({
  width,
  height,
  encode: (region) => Promise.resolve({ mimeType: 'image/png', data: JSON.stringify(region) }),
});

describe('readFloorplan', () => {
  it('locates on the whole page, crops with a margin and reads a small crop in one call', async () => {
    const sent: Tile[] = [];
    const inputs: FloorplanInput[] = [];
    const progress: ReadProgress[] = [];
    const reading = await readFloorplan(
      image(2000, 1000),
      {
        locate: (input, frame) => {
          sent.push(JSON.parse(input.image.data) as Tile);
          expect(frame).toEqual({ x: 0, y: 0, width: 2000, height: 1000 });
          return Promise.resolve(located({ xmin: 250, ymin: 250, xmax: 750, ymax: 750 }));
        },
        floorplan: (input) => {
          inputs.push(input);
          return Promise.resolve(output());
        },
      },
      (p) => progress.push(p),
    );
    expect(sent).toEqual([{ x: 0, y: 0, width: 2000, height: 1000 }]);
    expect(reading.crop).toEqual({ x: 460, y: 210, width: 1080, height: 580 });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ frame: reading.crop, tile: false });
    expect(JSON.parse(inputs[0]!.image.data)).toEqual(reading.crop);
    expect(reading.frame).toEqual(reading.crop);
    expect(reading.output).toEqual(output());
    expect(progress).toEqual([{ step: 'locate' }, { step: 'tile', index: 0, count: 1 }]);
  });

  it('carries the evidence the locate call read outside the plan, in full-image pixels', async () => {
    const evidence = {
      scaleText: 'Skala 1:100',
      paperSize: 'A4' as const,
      totalArea: 23,
      ceilingHeight: 2.55,
      scaleBar: {
        unit: 'm' as const,
        ticks: [
          { value: 0, point: { x: 100, y: 950 } },
          { value: 5, point: { x: 350, y: 950 } },
        ],
      },
    };
    const reading = await readFloorplan(image(2000, 1000), {
      locate: () =>
        Promise.resolve(located({ xmin: 250, ymin: 250, xmax: 750, ymax: 750 }, evidence)),
      floorplan: () => Promise.resolve(output()),
    });
    expect(reading.page).toEqual({
      ...evidence,
      scaleBar: {
        unit: 'm',
        ticks: [
          { value: 0, point: { x: 200, y: 950 } },
          { value: 5, point: { x: 700, y: 950 } },
        ],
      },
    });
    // The scale bar lies below the crop, which the detail call never sees.
    expect(reading.crop!.y + reading.crop!.height).toBeLessThan(950);
    // Only the scale and size evidence, not the box.
    expect(Object.keys(reading.page!).sort()).toEqual(Object.keys(page()).sort());
  });

  it('tiles a large crop, reads each tile marked as a tile, and merges', async () => {
    const frames: Tile[] = [];
    const reading = await readFloorplan(image(5000, 3000), {
      locate: () => Promise.resolve(located(null)),
      floorplan: (input) => {
        expect(input.tile).toBe(true);
        frames.push(input.frame);
        return Promise.resolve(output());
      },
    });
    expect(frames).toEqual(planTiles(5000, 3000));
    expect(reading.frame).toEqual({ x: 0, y: 0, width: 5000, height: 3000 });
    expect(reading.output).not.toBeNull();
  });

  it('stops at the first call that returns nothing', async () => {
    let tiles = 0;
    const noLocate = await readFloorplan(image(1000, 1000), {
      locate: () => Promise.resolve(null),
      floorplan: () => {
        tiles++;
        return Promise.resolve(output());
      },
    });
    expect(noLocate).toEqual({ crop: null, tiles: [], output: null, frame: null, page: null });
    expect(tiles).toBe(0);

    const noTile = await readFloorplan(image(5000, 3000), {
      locate: () => Promise.resolve(located(null)),
      floorplan: () => {
        tiles++;
        return Promise.resolve(null);
      },
    });
    expect(tiles).toBe(1);
    expect(noTile.output).toBeNull();
    expect(noTile.frame).toBeNull();
  });
});
