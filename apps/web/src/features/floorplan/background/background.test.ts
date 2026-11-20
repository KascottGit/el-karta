import {
  applyEdit,
  backgroundPlacement,
  DEFAULT_METRES_PER_PIXEL,
  distance,
  generateProject,
  imageToWorld,
} from '@el-karta/core';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyPlanFile,
  imageBounds,
  PDF_LONG_SIDE,
  PDF_MAX_PIXELS,
  pdfRenderScale,
} from './plan-file';
import { measuredScale, normalizeDegrees, placeBackground, rotatedAboutCenter } from './placement';
import { createSignedUrlCache } from './signed-urls';

describe('plan files', () => {
  it('accepts images and PDFs, including PDFs without a type', () => {
    expect(classifyPlanFile({ name: 'plan.png', type: 'image/png' })).toEqual({
      kind: 'image',
      extension: 'png',
      contentType: 'image/png',
    });
    expect(classifyPlanFile({ name: 'a.jpeg', type: 'image/jpeg' })).toMatchObject({
      extension: 'jpg',
    });
    expect(classifyPlanFile({ name: 'ritning.pdf', type: 'application/pdf' })).toEqual({
      kind: 'pdf',
    });
    expect(classifyPlanFile({ name: 'RITNING.PDF', type: '' })).toEqual({ kind: 'pdf' });
    expect(classifyPlanFile({ name: 'plan.gif', type: 'image/gif' }).kind).toBe('unsupported');
    expect(classifyPlanFile({ name: 'plan.dwg', type: '' }).kind).toBe('unsupported');
  });

  it('renders a PDF page with its long side at the tracing resolution', () => {
    // A4 landscape at 72 units per inch.
    const scale = pdfRenderScale(842, 595);
    expect(842 * scale).toBeCloseTo(PDF_LONG_SIDE, 6);
    expect(842 * scale * 595 * scale).toBeLessThanOrEqual(PDF_MAX_PIXELS);
  });

  it('caps the pixel count for square pages', () => {
    const scale = pdfRenderScale(1000, 1000, 5000);
    expect(1000 * scale * 1000 * scale).toBeCloseTo(PDF_MAX_PIXELS, 0);
    expect(1000 * scale).toBeLessThan(5000);
  });

  it('bounds the rotated, scaled image in the plan', () => {
    const placement = { offset: { x: 1, y: 2 }, rotation: 90, metresPerPixel: 0.01 };
    const bounds = imageBounds(placement, { width: 400, height: 200 })!;
    expect(bounds.minX).toBeCloseTo(-1, 9);
    expect(bounds.maxX).toBeCloseTo(1, 9);
    expect(bounds.minY).toBeCloseTo(2, 9);
    expect(bounds.maxY).toBeCloseTo(6, 9);
  });
});

describe('signed URL cache', () => {
  function setup() {
    let clock = 0;
    let n = 0;
    const sign = vi.fn((id: string) =>
      Promise.resolve({ url: `${id}#${++n}`, expiresAt: clock + 3_600_000 }),
    );
    const cache = createSignedUrlCache(sign, () => clock);
    return {
      cache,
      sign,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it('reuses a URL until shortly before it expires, then signs a new one', async () => {
    const { cache, sign, advance } = setup();
    expect(await cache.get('a')).toBe('a#1');
    advance(3_000_000);
    expect(await cache.get('a')).toBe('a#1');
    advance(560_000);
    expect(await cache.get('a')).toBe('a#2');
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it('shares one request between callers and keeps attachments apart', async () => {
    const { cache, sign } = setup();
    const urls = await Promise.all([cache.get('a'), cache.get('a'), cache.get('b')]);
    expect(urls).toEqual(['a#1', 'a#1', 'b#2']);
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it('signs again after an invalidation or a failed request', async () => {
    const { cache, sign } = setup();
    await cache.get('a');
    cache.invalidate('a');
    expect(await cache.get('a')).toBe('a#2');

    sign.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    cache.invalidate('a');
    await expect(cache.get('a')).rejects.toThrow('offline');
    expect(await cache.get('a')).toBe('a#3');
  });
});

describe('placing the background', () => {
  function floorWithBackground() {
    const model = generateProject('small', 7);
    const floor = Object.values(model.floors)[0]!;
    const background = { attachmentId: 'plan', offset: { x: 2, y: 3 }, rotation: 0 };
    return { model, floor, data: { ...floor.data, background } };
  }

  it('normalizes rotations to (-180, 180]', () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(270)).toBe(-90);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(540)).toBe(180);
    expect(normalizeDegrees(-450)).toBe(-90);
  });

  it('moves and turns only the image', () => {
    const { model, floor, data } = floorWithBackground();
    const withBackground = {
      ...model,
      floors: { ...model.floors, [floor.id]: { ...floor, data } },
    };
    const edit = placeBackground(floor.id, data, { offset: { x: -1, y: 4 }, rotation: 450 })!;
    const next = applyEdit(withBackground, edit).model.floors[floor.id]!.data;
    expect(next.background).toEqual({
      attachmentId: 'plan',
      offset: { x: -1, y: 4 },
      rotation: 90,
    });
    expect(next.walls).toBe(data.walls);
    expect(
      placeBackground(floor.id, floor.data, { offset: { x: 0, y: 0 }, rotation: 0 }),
    ).toBeNull();
  });

  it('turns about the image centre', () => {
    const { data } = floorWithBackground();
    const placement = backgroundPlacement(data.background, data.scale)!;
    const size = { width: 800, height: 600 };
    const turned = rotatedAboutCenter(placement, 30, size);
    expect(turned.rotation).toBe(30);
    const center = imageToWorld(placement, { x: 400, y: 300 });
    const after = imageToWorld(turned, { x: 400, y: 300 });
    expect(after.x).toBeCloseTo(center.x, 9);
    expect(after.y).toBeCloseTo(center.y, 9);
  });

  it('sets a user scale from two clicked points, keeping their middle in place', () => {
    const { model, floor, data } = floorWithBackground();
    const withBackground = {
      ...model,
      floors: { ...model.floors, [floor.id]: { ...floor, data } },
    };
    // Shown at the default scale, the two clicks are 3 m apart; in reality they are 4,5 m apart.
    const a = { x: 2.5, y: 4 };
    const b = { x: 5.5, y: 4 };
    const measured = measuredScale(floor.id, data, a, b, 4.5)!;
    expect(measured.metresPerPixel).toBeCloseTo(DEFAULT_METRES_PER_PIXEL * 1.5, 12);
    expect(measured.growth).toBeCloseTo(1.5, 12);
    expect(measured.pivot).toEqual({ x: 4, y: 4 });

    const next = applyEdit(withBackground, measured.edit).model.floors[floor.id]!.data;
    expect(next.scale).toEqual({ source: 'user', metresPerPixel: measured.metresPerPixel });
    expect(next.walls).toBe(data.walls);
    const before = backgroundPlacement(data.background, data.scale)!;
    const after = backgroundPlacement(next.background, next.scale)!;
    const px = (p: { x: number; y: number }) => ({
      x: (p.x - before.offset.x) / before.metresPerPixel,
      y: (p.y - before.offset.y) / before.metresPerPixel,
    });
    expect(distance(imageToWorld(after, px(a)), imageToWorld(after, px(b)))).toBeCloseTo(4.5, 9);
    const middle = imageToWorld(after, px({ x: 4, y: 4 }));
    expect(middle.x).toBeCloseTo(4, 9);
    expect(middle.y).toBeCloseTo(4, 9);
  });

  it('refuses a measurement without a background, of zero length or with a bad length', () => {
    const { floor, data } = floorWithBackground();
    const a = { x: 1, y: 1 };
    expect(measuredScale(floor.id, floor.data, a, { x: 3, y: 1 }, 2)).toBeNull();
    expect(measuredScale(floor.id, data, a, a, 2)).toBeNull();
    expect(measuredScale(floor.id, data, a, { x: 3, y: 1 }, 0)).toBeNull();
  });
});
