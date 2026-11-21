import { applyEdit, createEmptyProject, emptyFloorData, imageToWorld } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { loadPdfPageSize, savePdfPageSize } from './pdf-page';
import { measuredScale } from './placement';
import { createMemoryJson } from './project-json';
import { hasDrawnContent, rescaleEdit, rescaleOffer } from './rescale';

function floorWithWall() {
  const model = createEmptyProject({
    id: () => crypto.randomUUID(),
    name: 'Test',
    kind: 'home',
    buildingName: 'Hus',
    floorName: 'Plan 1',
  });
  const floor = Object.values(model.floors)[0]!;
  floor.data.background = { attachmentId: 'a', offset: { x: 0, y: 0 }, rotation: 0 };
  floor.data.walls['w'] = {
    id: 'w',
    // Traced on the image at the default 1 cm per pixel: from pixel (100, 100) to (500, 100).
    a: { x: 1, y: 1 },
    b: { x: 5, y: 1 },
    thickness: 0.1,
    provenance: { status: 'manual' },
  };
  return { model, floor };
}

describe('rescaling after a new scale', () => {
  it('offers to rescale only a floor with something drawn, and only when the size changed', () => {
    const empty = emptyFloorData(2.5, 0);
    expect(hasDrawnContent(empty)).toBe(false);
    expect(
      hasDrawnContent({ ...empty, grid: { xLines: [{ label: 'A', pos: 0 }], yLines: [] } }),
    ).toBe(true);
    const { floor } = floorWithWall();
    expect(hasDrawnContent(floor.data)).toBe(true);
    const pivot = { x: 1, y: 1 };
    expect(rescaleOffer(floor.id, empty, { growth: 2, pivot })).toBeNull();
    expect(rescaleOffer(floor.id, floor.data, { growth: 1, pivot })).toBeNull();
    expect(rescaleOffer(floor.id, floor.data, { growth: 0.8, pivot })).toEqual({
      floorId: floor.id,
      growth: 0.8,
      pivot,
    });
  });

  it('keeps what is drawn on the image it was traced from', () => {
    const { model, floor } = floorWithWall();
    // The wall's 400 px are really 3.2 m: 8 mm per pixel.
    const measured = measuredScale(floor.id, floor.data, { x: 1, y: 1 }, { x: 5, y: 1 }, 3.2)!;
    const scaled = applyEdit(model, measured.edit).model;
    const offer = rescaleOffer(floor.id, floor.data, measured)!;
    const after = applyEdit(scaled, rescaleEdit(offer)).model.floors[floor.id]!.data;
    const placement = { ...after.background!, metresPerPixel: after.scale!.metresPerPixel };
    const wall = after.walls['w']!;
    for (const [end, px] of [
      [wall.a, { x: 100, y: 100 }],
      [wall.b, { x: 500, y: 100 }],
    ] as const) {
      const onImage = imageToWorld(placement, px);
      expect(end.x).toBeCloseTo(onImage.x, 9);
      expect(end.y).toBeCloseTo(onImage.y, 9);
    }
    expect(wall.thickness).toBeCloseTo(0.08, 9);
  });
});

describe('PDF page size beside the attachment', () => {
  it('is stored per attachment and read back; anything else reads as unknown', async () => {
    const files = createMemoryJson();
    await savePdfPageSize('p', 'a', { widthMm: 210, heightMm: 297 }, files);
    expect(await loadPdfPageSize('p', 'a', files)).toEqual({ widthMm: 210, heightMm: 297 });
    expect(await loadPdfPageSize('p', 'other', files)).toBeNull();
    await files.save('p', 'b.pdf-page', { widthMm: 'A4' });
    expect(await loadPdfPageSize('p', 'b', files)).toBeNull();
  });
});
