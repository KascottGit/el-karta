import { floorplanPass, planTiles, type Tile } from '@el-karta/ai-passes';
import { createFakeProvider, ProviderError, type AiProvider } from '@el-karta/ai-providers';
import { describe, expect, it } from 'vitest';
import {
  runFloorplanPipeline,
  stripPageScale,
  stripPrintedScale,
  type PlanImage,
} from '../floorplan/pipeline.ts';
import { flat, locate } from './fixtures.ts';

/** An image that "encodes" a region as its JSON, so tests can see what each call was sent. */
const fakeImage = (width: number, height: number, pdfPageWidthMm?: number): PlanImage => ({
  width,
  height,
  pdfPageWidthMm,
  encode: (region: Tile) =>
    Promise.resolve({ mimeType: 'image/png', data: JSON.stringify(region) }),
});
const promptText = (tile: boolean) =>
  floorplanPass.prompt({
    image: { mimeType: 'x', data: 'x' },
    frame: { x: 0, y: 0, width: 1, height: 1 },
    tile,
  }).text;
const wholePage = locate(null);
const sent = (provider: ReturnType<typeof createFakeProvider>) =>
  provider.calls.map((c) => JSON.parse(c.images[0]!.data) as Tile);

describe('runFloorplanPipeline', () => {
  it('locates on the whole page, then reads the crop in one call when it is small', async () => {
    const provider = createFakeProvider([
      locate({ xmin: 250, ymin: 250, xmax: 750, ymax: 750 }),
      flat(),
    ]);
    const result = await runFloorplanPipeline(fakeImage(2000, 2000, 210), {
      provider,
      model: 'm',
      mode: 'printed',
    });
    expect(result.status).toBe('ok');
    expect(result.calls).toBe(2);
    const [page, crop] = sent(provider);
    expect(page).toEqual({ x: 0, y: 0, width: 2000, height: 2000 });
    expect(crop).toEqual(result.crop);
    expect(crop!.width).toBeLessThan(1200);
    expect(provider.calls[1]!.messages[0]!.text).toBe(promptText(false));
    expect(result.interpretation?.scale.status).toBe('printed');
    // 1:100 on a 210 mm page that is 2000 px wide.
    expect(result.interpretation?.scale.scale?.metresPerPixel).toBeCloseTo(21 / 2000);
    const kinds = result.interpretation!.drafts.map((d) => d.kind);
    expect(kinds.filter((k) => k === 'room')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'opening')).toHaveLength(2);
  });

  it('adds up the cost of each pass run from the price table, and leaves it out without a price', async () => {
    const run = (model: string) => {
      const fake = createFakeProvider([
        locate({ xmin: 250, ymin: 250, xmax: 750, ymax: 750 }),
        flat(),
      ]);
      const gemini: AiProvider = {
        id: 'gemini',
        generateStructured: async (request) => ({
          ...(await fake.generateStructured(request)),
          usage: { inputTokens: 1000, outputTokens: 2000 },
        }),
      };
      return runFloorplanPipeline(fakeImage(2000, 2000, 210), {
        provider: gemini,
        model,
        mode: 'printed',
      });
    };
    const priced = await run('gemini-3-flash-preview');
    expect(priced.calls).toBe(2);
    expect(priced.costUsd).toBeCloseTo((2 * (1000 * 0.5 + 2000 * 3)) / 1e6, 12);
    expect((await run('gemini-unknown')).costUsd).toBeUndefined();
  });

  it('tiles a large crop and calls the model once per tile, then merges', async () => {
    const provider = createFakeProvider([
      locate({ xmin: 0, ymin: 0, xmax: 1000, ymax: 1000 }),
      flat(),
    ]);
    const result = await runFloorplanPipeline(fakeImage(5000, 3000), {
      provider,
      model: 'm',
      mode: 'printed',
    });
    const tiles = planTiles(5000, 3000);
    expect(tiles.length).toBeGreaterThan(1);
    expect(sent(provider).slice(1)).toEqual(tiles);
    expect(provider.calls.slice(1).map((c) => c.messages[0]!.text)).toEqual(
      tiles.map(() => promptText(true)),
    );
    expect(result.frame).toEqual({ x: 0, y: 0, width: 5000, height: 3000 });
    expect(result.output).not.toBeNull();
  });

  it('hides printed scale evidence in estimate mode and estimates from standard objects', async () => {
    const reply = flat({
      // 16.8 m over 800 px agrees with 1:100 on a 210 mm page 1000 px wide.
      dimensions: [{ value: 16.8, unit: 'm', a: { x: 100, y: 50 }, b: { x: 900, y: 50 } }],
      standardObjects: [
        { type: 'interior_door_leaf', a: { x: 600, y: 450 }, b: { x: 600, y: 535 } },
      ],
    });
    const printed = await runFloorplanPipeline(fakeImage(1000, 1000, 210), {
      provider: createFakeProvider([wholePage, reply]),
      model: 'm',
      mode: 'printed',
    });
    expect(printed.interpretation?.scale.status).toBe('printed');

    const estimate = await runFloorplanPipeline(fakeImage(1000, 1000, 210), {
      provider: createFakeProvider([wholePage, reply]),
      model: 'm',
      mode: 'estimate',
    });
    expect(estimate.interpretation?.scale.status).toBe('estimate');
    expect(estimate.interpretation?.scale.candidates.map((c) => c.evidence)).toEqual([
      'standard_object',
    ]);
    // 0.85 m over 85 px of a 1000 px wide whole page.
    expect(estimate.interpretation?.scale.scale?.metresPerPixel).toBeCloseTo(0.01);
  });

  it('takes the scale printed outside the plan from the locate call, but not in estimate mode', async () => {
    // The ratio and a scale bar are in the legend, below the crop; the crop holds no scale.
    const legend = {
      scaleText: 'Skala 1:100',
      scaleBar: {
        unit: 'm' as const,
        ticks: [
          { value: 0, point: { x: 100, y: 900 } },
          { value: 10, point: { x: 600, y: 900 } },
        ],
      },
      ceilingHeight: 2.5,
    };
    const box = { xmin: 250, ymin: 250, xmax: 750, ymax: 750 };
    const reply = flat({
      scaleText: null,
      standardObjects: [
        { type: 'interior_door_leaf', a: { x: 600, y: 450 }, b: { x: 600, y: 535 } },
      ],
    });
    const printed = await runFloorplanPipeline(fakeImage(2000, 2000, 200), {
      provider: createFakeProvider([locate(box, legend), reply]),
      model: 'm',
      mode: 'printed',
    });
    expect(printed.page?.scaleBar?.ticks.map((t) => t.point)).toEqual([
      { x: 200, y: 1800 },
      { x: 1200, y: 1800 },
    ]);
    expect(printed.interpretation?.scale.status).toBe('printed');
    // 1:100 on a 200 mm page 2000 px wide, and 10 m over 1000 px: the same.
    expect(printed.interpretation?.scale.candidates.map((c) => c.evidence)).toEqual([
      'ratio',
      'scale_bar',
      'standard_object',
    ]);
    expect(printed.interpretation?.scale.scale?.metresPerPixel).toBeCloseTo(0.01, 9);

    const estimate = await runFloorplanPipeline(fakeImage(2000, 2000, 200), {
      provider: createFakeProvider([locate(box, legend), reply]),
      model: 'm',
      mode: 'estimate',
    });
    expect(estimate.page).toMatchObject({ scaleText: null, scaleBar: null, ceilingHeight: 2.5 });
    expect(estimate.interpretation?.scale.candidates.map((c) => c.evidence)).toEqual([
      'standard_object',
    ]);
  });

  it('stops at the first call that returns nothing', async () => {
    const provider = createFakeProvider([new ProviderError('rate_limited', 'slow down')]);
    const result = await runFloorplanPipeline(fakeImage(1000, 1000), {
      provider,
      model: 'm',
      mode: 'printed',
    });
    expect(result).toMatchObject({ status: 'rate_limited', tiles: [], interpretation: null });
    expect(result.error).toContain('slow down');
    expect(provider.calls).toHaveLength(1);
  });
});

describe('stripPrintedScale', () => {
  it('removes every kind of printed scale evidence and nothing else', () => {
    const output = flat({
      dimensions: [{ value: 4, unit: 'm', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }],
      scaleBar: { unit: 'm', ticks: [] },
      paperSize: 'A4',
      totalArea: 40,
      rooms: flat().rooms.map((r) => ({ ...r, area: 12 })),
    });
    const stripped = stripPrintedScale(output);
    expect(stripped).toMatchObject({
      scaleText: null,
      paperSize: null,
      dimensions: [],
      scaleBar: null,
      totalArea: null,
    });
    expect(stripped.rooms.map((r) => r.area)).toEqual([null, null]);
    expect(stripped.walls).toEqual(output.walls);
    expect(stripped.standardObjects).toEqual(output.standardObjects);
  });

  it('strips the page evidence the same way, keeping the ceiling height', () => {
    const page = locate(null, {
      scaleText: '1:50',
      paperSize: 'A3',
      totalArea: 40,
      ceilingHeight: 2.4,
      scaleBar: { unit: 'm', ticks: [] },
    });
    expect(stripPageScale(page)).toEqual({ ...locate(null), ceilingHeight: 2.4 });
  });
});
