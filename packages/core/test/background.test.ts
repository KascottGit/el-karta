import { applyPatches } from 'immer';
import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  backgroundPlacement,
  combine,
  DEFAULT_METRES_PER_PIXEL,
  distance,
  imageToWorld,
  metresPerPixelFrom,
  setBackground,
  setScale,
  splitByDocument,
  transformAbout,
  worldToImage,
  type BackgroundPlacement,
  type Pt,
} from '../src/index.ts';
import { ModelBuilder } from './builder.ts';

const close = (actual: Pt, expected: Pt) => {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
};

describe('image to world placement', () => {
  const placement: BackgroundPlacement = {
    offset: { x: 3, y: -2 },
    rotation: 0,
    metresPerPixel: 0.02,
  };

  it('puts pixel (0, 0) at the offset and scales pixels by metres per pixel, y down', () => {
    close(imageToWorld(placement, { x: 0, y: 0 }), { x: 3, y: -2 });
    close(imageToWorld(placement, { x: 100, y: 50 }), { x: 5, y: -1 });
  });

  it('rotates clockwise on screen about the top-left corner, in degrees', () => {
    const turned = { ...placement, rotation: 90 };
    // Along the image's x axis is straight down the plan after a quarter turn clockwise.
    close(imageToWorld(turned, { x: 100, y: 0 }), { x: 3, y: 0 });
    close(imageToWorld(turned, { x: 0, y: 100 }), { x: 1, y: -2 });
  });

  it('round-trips through worldToImage at any rotation', () => {
    for (const rotation of [0, 17.5, -90, 233]) {
      const p = { ...placement, rotation };
      const px = { x: 1234.5, y: -87.25 };
      close(worldToImage(p, imageToWorld(p, px)), px);
    }
  });

  it('keeps distances in proportion to metres per pixel', () => {
    const p = { ...placement, rotation: 31 };
    const a = { x: 10, y: 20 };
    const b = { x: 310, y: 420 };
    expect(distance(imageToWorld(p, a), imageToWorld(p, b))).toBeCloseTo(500 * 0.02, 9);
  });

  it('uses the default scale until one is set, and none without a background', () => {
    const background = { attachmentId: 'a', offset: { x: 1, y: 2 }, rotation: 5 };
    expect(backgroundPlacement(background, undefined)).toEqual({
      offset: { x: 1, y: 2 },
      rotation: 5,
      metresPerPixel: DEFAULT_METRES_PER_PIXEL,
    });
    expect(
      backgroundPlacement(background, { source: 'user', metresPerPixel: 0.004 })?.metresPerPixel,
    ).toBe(0.004);
    expect(backgroundPlacement(undefined, { source: 'user', metresPerPixel: 0.004 })).toBeNull();
  });
});

describe('transformAbout', () => {
  const placement: BackgroundPlacement = {
    offset: { x: 2, y: 1 },
    rotation: 10,
    metresPerPixel: 0.01,
  };
  const pivot = { x: 400, y: 300 };

  it('keeps the pivot pixel in place while rotating and rescaling', () => {
    const before = imageToWorld(placement, pivot);
    const rotated = transformAbout(placement, pivot, { rotation: 55 });
    const scaled = transformAbout(placement, pivot, { metresPerPixel: 0.0037 });
    const both = transformAbout(placement, pivot, { rotation: -20, metresPerPixel: 0.05 });
    for (const next of [rotated, scaled, both]) close(imageToWorld(next, pivot), before);
    expect(rotated).toMatchObject({ rotation: 55, metresPerPixel: 0.01 });
    expect(scaled).toMatchObject({ rotation: 10, metresPerPixel: 0.0037 });
  });

  it('changes nothing without a change', () => {
    const same = transformAbout(placement, pivot, {});
    close(same.offset, placement.offset);
  });
});

describe('scale from a measurement', () => {
  it('is the known length over the pixel distance', () => {
    expect(metresPerPixelFrom({ x: 0, y: 0 }, { x: 300, y: 400 }, 5)).toBeCloseTo(0.01, 12);
  });

  it('refuses points on top of each other and lengths that are not positive', () => {
    expect(metresPerPixelFrom({ x: 5, y: 5 }, { x: 6, y: 5 }, 3)).toBeNull();
    expect(metresPerPixelFrom({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toBeNull();
    expect(metresPerPixelFrom({ x: 0, y: 0 }, { x: 100, y: 0 }, -2)).toBeNull();
    expect(metresPerPixelFrom({ x: 0, y: 0 }, { x: 100, y: 0 }, Number.NaN)).toBeNull();
  });

  it('scales a plan to within 1% from one known dimension clicked a little off', () => {
    // A plan drawn at 80 px per metre, rotated and shown at the default scale before measuring.
    const trueMpp = 1 / 80;
    const shown: BackgroundPlacement = {
      offset: { x: -4, y: 7 },
      rotation: 12,
      metresPerPixel: DEFAULT_METRES_PER_PIXEL,
    };
    // A 6 m wall from (120, 200) to (600, 200); each click lands within 1.5 image pixels of its end.
    const clickA = imageToWorld(shown, { x: 121.5, y: 199 });
    const clickB = imageToWorld(shown, { x: 598.5, y: 201 });
    const a = worldToImage(shown, clickA);
    const b = worldToImage(shown, clickB);
    const mpp = metresPerPixelFrom(a, b, 6)!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const scaled = transformAbout(shown, mid, { metresPerPixel: mpp });

    expect(Math.abs(mpp - trueMpp) / trueMpp).toBeLessThan(0.01);
    // Another dimension on the same plan, a 3.5 m wall, now measures 3.5 m in the plan within 1%.
    const other = distance(
      imageToWorld(scaled, { x: 700, y: 100 }),
      imageToWorld(scaled, { x: 700, y: 380 }),
    );
    expect(Math.abs(other - 3.5) / 3.5).toBeLessThan(0.01);
    // The midpoint of the measurement stays put on screen.
    close(imageToWorld(scaled, mid), imageToWorld(shown, mid));
  });
});

describe('background and scale edits', () => {
  function setup() {
    const b = new ModelBuilder(1);
    b.wall(0, { x: 0, y: 0 }, { x: 4, y: 0 });
    const model = b.build();
    return { model, floorId: b.floors[0]!.id };
  }
  const background = { attachmentId: 'att', pdfPage: 2, offset: { x: 1, y: 1 }, rotation: 3 };

  it('set and remove the background and scale on the floor document only, leaving walls alone', () => {
    const { model, floorId } = setup();
    const walls = model.floors[floorId]!.data.walls;
    const set = applyEdit(
      model,
      combine(
        setBackground(floorId, background),
        setScale(floorId, { source: 'user', metresPerPixel: 0.02 }),
      ),
    );
    const data = set.model.floors[floorId]!.data;
    expect(data.background).toEqual(background);
    expect(data.scale).toEqual({ source: 'user', metresPerPixel: 0.02 });
    expect(data.walls).toBe(walls);
    expect([...splitByDocument(set.patches).keys()]).toEqual([floorId]);

    const removed = applyEdit(
      set.model,
      combine(setBackground(floorId, null), setScale(floorId, null)),
    );
    expect('background' in removed.model.floors[floorId]!.data).toBe(false);
    expect('scale' in removed.model.floors[floorId]!.data).toBe(false);
  });

  it('undo restores the previous placement', () => {
    const { model, floorId } = setup();
    const first = applyEdit(model, setBackground(floorId, background)).model;
    const moved = applyEdit(
      first,
      setBackground(floorId, { ...background, offset: { x: 5, y: 6 } }),
    );
    const undone = applyPatches(moved.model, moved.inversePatches);
    expect(undone.floors[floorId]!.data.background).toEqual(background);
  });

  it('fails on an unknown floor', () => {
    const { model } = setup();
    expect(() => applyEdit(model, setScale('nope', null))).toThrow(/Unknown floor/);
  });
});
