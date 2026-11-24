import { createSuggestionKinds, type Device, type SuggestionDraft } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import {
  interpretPhoto,
  ROUGH_CONFIDENCE,
  type DevicePayload,
  type PhotoFeature,
  type PhotoOutput,
  type PhotoReference,
} from '../../src/index.ts';
import {
  camera,
  feature,
  id,
  ids,
  jitter,
  OPENING,
  options,
  output,
  PHOTO,
  random,
  reference,
  room,
  ROOM,
  WALL,
  withSmallWindow,
  type Camera,
} from './fixtures.ts';
import { deviceBox, references } from './scene.ts';

const kinds = createSuggestionKinds();
const devices = (drafts: SuggestionDraft[]) =>
  drafts.filter((d) => d.kind === 'device').map((d) => d.payload as DevicePayload);
const wallPlacement = (d: DevicePayload) => {
  if (d.placement.kind !== 'wall') throw new Error('not on a wall');
  return d.placement;
};

/** Looking at wall A from near the opposite wall, slightly turned and tilted down. */
const facingA = camera({ x: 2, y: 2.9, z: 1.4 }, -Math.PI / 2 + 0.05, -0.05);

/** Devices on A by metres from its face's left end (seen from the room) and height. */
const onA = [
  { type: 'power.outlet', fromLeft: 0.55, v: 0.3 },
  { type: 'power.outlet', fromLeft: 1.9, v: 0.25 },
  { type: 'power.switch', fromLeft: 3.9, v: 1.05 },
  { type: 'power.switch', fromLeft: 0.3, v: 1.4 },
];
const uOnA = (reverse: boolean, fromLeft: number) => (reverse ? 4.05 - fromLeft : 0.05 + fromLeft);

function sceneOnA(cam: Camera, reverse: boolean, truthCeiling = 2.5): PhotoOutput {
  const truth = room({ reverseA: reverse, ceilingHeight: truthCeiling });
  return output({
    references: references(cam, truth, [0]),
    features: onA.map((d) =>
      feature({
        deviceType: d.type,
        box: deviceBox(cam, truth, 0, uOnA(reverse, d.fromLeft), d.v),
      }),
    ),
  });
}

function noisy(out: PhotoOutput, seed: number, amount: number): PhotoOutput {
  const rand = random(seed);
  return {
    ...out,
    references: out.references.map((r) => ({ ...r, point: jitter(r.point, amount, rand) })),
    features: out.features.map((f): PhotoFeature => {
      const d = jitter({ x: 0, y: 0 }, amount, rand);
      const b = f.box;
      return {
        ...f,
        box: { xmin: b.xmin + d.x, xmax: b.xmax + d.x, ymin: b.ymin + d.y, ymax: b.ymax + d.y },
      };
    }),
  };
}

describe('interpretPhoto: placement through the homography', () => {
  for (const reverse of [false, true]) {
    const side = reverse ? 'left' : 'right';
    it(`round-trips devices on a wall seen from its ${side} side within 2 cm`, () => {
      const context = room({ reverseA: reverse });
      const drafts = interpretPhoto(sceneOnA(facingA, reverse), options(context), ids());
      const placed = devices(drafts);
      expect(placed).toHaveLength(onA.length);
      placed.forEach((d, i) => {
        const truth = onA[i]!;
        expect(`${d.domain}.${d.type}`).toBe(truth.type);
        const p = wallPlacement(d);
        expect(p).toMatchObject({ wallId: WALL.A, side });
        expect(Math.abs(p.offset - uOnA(reverse, truth.fromLeft))).toBeLessThanOrEqual(0.02);
        expect(Math.abs(p.height - truth.v)).toBeLessThanOrEqual(0.02);
      });
      expect(drafts.every((d) => d.issues.length === 0)).toBe(true);
      // Exact points: no correction to suggest.
      expect(drafts.filter((d) => d.kind !== 'device')).toEqual([]);
    });
  }

  it('stays within 10 cm with 1 % noise on every point', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const out = noisy(sceneOnA(facingA, false), seed, 10);
      const placed = devices(interpretPhoto(out, options(), ids()));
      expect(placed).toHaveLength(onA.length);
      placed.forEach((d, i) => {
        const truth = onA[i]!;
        const p = wallPlacement(d);
        expect(Math.abs(p.offset - uOnA(false, truth.fromLeft))).toBeLessThanOrEqual(0.1);
        expect(Math.abs(p.height - truth.v)).toBeLessThanOrEqual(0.1);
      });
    }
  });

  it('places features on another wall that has its own references, roughly on one without', () => {
    // Looking into the corner of A and B: B's window and floor corners are in view.
    const cam = camera({ x: 1.2, y: 2.2, z: 1.4 }, -Math.PI / 6, -0.05);
    const truth = room();
    const refs = references(cam, truth, [1]);
    expect(refs.length).toBeGreaterThanOrEqual(4);
    const out = output({
      references: refs,
      features: [
        feature({ wall: 'B', box: deviceBox(cam, truth, 1, 2.4, 0.3) }),
        feature({ wall: 'A', box: deviceBox(cam, truth, 0, 3.4, 0.3) }),
      ],
    });
    const [onB, onAWall] = devices(interpretPhoto(out, options(), ids()));
    expect(wallPlacement(onB!).wallId).toBe(WALL.B);
    expect(Math.abs(wallPlacement(onB!).offset - 2.4)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(wallPlacement(onB!).height - 0.3)).toBeLessThanOrEqual(0.02);
    expect(wallPlacement(onAWall!)).toMatchObject({ wallId: WALL.A, height: 0.25 });
    const draftA = interpretPhoto(out, options(), ids())[1]!;
    expect(draftA.issues).toEqual([{ code: 'photo.position-rough', severity: 'warning' }]);
  });
});

describe('interpretPhoto: rough positions', () => {
  const corners = [
    reference('wall_corner', 'A', 'bottom_left', { x: 100, y: 900 }),
    reference('wall_corner', 'A', 'bottom_right', { x: 900, y: 900 }),
  ];
  const at = (x: number, type = 'power.outlet') =>
    feature({ deviceType: type, box: { xmin: x - 10, xmax: x + 10, ymin: 500, ymax: 520 } });

  it('interpolates between two references and uses the default height', () => {
    const drafts = interpretPhoto(
      output({ references: corners, features: [at(500, 'power.switch')] }),
      options(),
      ids(),
    );
    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;
    expect(wallPlacement(draft.payload as DevicePayload)).toMatchObject({
      offset: 2.05,
      height: 1.05,
    });
    expect(draft.issues).toEqual([{ code: 'photo.position-rough', severity: 'warning' }]);
    expect(draft.confidence).toBeCloseTo(0.9 * ROUGH_CONFIDENCE);
  });

  it('uses the nearest references on each side with three, and clamps past the last', () => {
    const refs = [
      ...corners,
      // O1's left jamb, 1.00 m from the face's left end.
      reference('opening_corner', 'O1', 'bottom_left', { x: 300, y: 700 }),
    ];
    const placed = devices(
      interpretPhoto(output({ references: refs, features: [at(200), at(990)] }), options(), ids()),
    );
    expect(placed.map((d) => wallPlacement(d).offset)).toEqual([0.55, 4.05]);
  });

  it('falls back when every reference lies on one line (floor level only)', () => {
    const refs = [
      ...corners,
      reference('opening_corner', 'O2', 'bottom_left', { x: 700, y: 900 }),
      reference('opening_corner', 'O2', 'bottom_right', { x: 800, y: 900 }),
    ];
    const [draft] = interpretPhoto(
      output({ references: refs, features: [at(500)] }),
      options(),
      ids(),
    );
    expect(draft!.issues).toEqual([{ code: 'photo.position-rough', severity: 'warning' }]);
  });
});

describe('interpretPhoto: corrections', () => {
  const corrections = (drafts: SuggestionDraft[]) => drafts.filter((d) => d.kind !== 'device');
  type Corrected = { id: string; width: number; height: number; offset: number; hinge?: string };
  const parse = (drafts: SuggestionDraft[]) =>
    corrections(drafts).map((d) => kinds.get(d.kind)!.parse(d.payload) as Corrected);
  /** A on the rich fixture (three openings) with the window's width and the door's height as given. */
  const rich = (width = 1.2, doorHeight = 2) => {
    const context = withSmallWindow(room());
    context.openings[0] = { ...context.openings[0]!, width, offset: 1.05 };
    context.openings[1] = { ...context.openings[1]!, height: doorHeight };
    return context;
  };
  const richScene = (truthCeiling = 2.5) =>
    output({
      references: references(facingA, withSmallWindow(room({ ceilingHeight: truthCeiling })), [0]),
    });

  it('suggests an opening correction only above 10 cm, keeping the opening id and hinge', () => {
    const out = richScene();
    const wrong = (width: number, doorHeight: number) =>
      parse(interpretPhoto(out, options(rich(width, doorHeight)), ids()));

    expect(wrong(1.15, 2)).toEqual([]);
    expect(wrong(1.2, 2.08)).toEqual([]);

    const [window, ...rest] = wrong(1.05, 2);
    expect(rest).toEqual([]);
    expect(window).toMatchObject({ id: OPENING.window, height: 1.2 });
    expect(window!.width).toBeCloseTo(1.2, 2);
    expect(window!.offset).toBeCloseTo(1.05, 2);

    const [door, ...none] = wrong(1.2, 1.85);
    expect(none).toEqual([]);
    expect(door).toMatchObject({ id: OPENING.door, width: 0.8, hinge: 'left' });
    expect(door!.height).toBeCloseTo(2, 2);
  });

  it('measures each opening without the others it contradicts', () => {
    const out = richScene();
    // The window 40 cm too narrow would skew a fit that kept its corners.
    const [window, ...rest] = parse(interpretPhoto(out, options(rich(0.8)), ids()));
    expect(rest).toEqual([]);
    expect(window!.width).toBeCloseTo(1.2, 2);
  });

  it('corrects nothing when two of three openings disagree, since any two could be the wrong ones', () => {
    const out = richScene();
    const context = withSmallWindow(room());
    context.openings[0] = { ...context.openings[0]!, width: 1.0 };
    context.openings[1] = { ...context.openings[1]!, height: 1.8 };
    expect(parse(interpretPhoto(out, options(context), ids()))).toEqual([]);
  });

  it('corrects nothing on a wall where either of two openings could be the wrong one', () => {
    // A has only its floor corners besides the window and the door; the ceiling is wrong too.
    const out = output({ references: references(facingA, room({ ceilingHeight: 2.7 }), [0]) });
    const context = room();
    context.openings[0] = { ...context.openings[0]!, width: 1.0 };
    expect(corrections(interpretPhoto(out, options(context), ids()))).toEqual([]);
  });

  it('suggests the ceiling height only when it differs by more than 5 cm', () => {
    const at = (truthCeiling: number) =>
      corrections(
        interpretPhoto(
          output({ references: references(facingA, room({ ceilingHeight: truthCeiling }), [0]) }),
          options(),
          ids(),
        ),
      );
    expect(at(2.53)).toEqual([]);
    const [draft] = at(2.65);
    expect(draft!.kind).toBe('room-ceiling-height');
    expect(kinds.get('room-ceiling-height')!.parse(draft!.payload)).toEqual({
      roomId: ROOM,
      ceilingHeight: 2.65,
    });
  });

  it('needs two ceiling corners that agree', () => {
    const refs = references(facingA, room({ ceilingHeight: 2.7 }), [0]);
    const isTopRight = (r: PhotoReference) => r.what === 'wall_corner' && r.corner === 'top_right';
    const one = refs.filter((r) => !isTopRight(r));
    expect(corrections(interpretPhoto(output({ references: one }), options(), ids()))).toEqual([]);
    const apart = refs.map((r) =>
      isTopRight(r) ? { ...r, point: { x: r.point.x, y: r.point.y - 30 } } : r,
    );
    expect(corrections(interpretPhoto(output({ references: apart }), options(), ids()))).toEqual(
      [],
    );
    expect(
      corrections(interpretPhoto(output({ references: refs }), options(), ids())),
    ).toHaveLength(1);
  });

  it('suggests nothing at 1 % noise when the model is right, and still finds 20 cm errors', () => {
    const found = (scene: PhotoOutput, context: ReturnType<typeof room>, kind: string) => {
      let n = 0;
      for (let seed = 1; seed <= 50; seed++) {
        const drafts = corrections(interpretPhoto(noisy(scene, seed, 10), options(context), ids()));
        if (drafts.some((d) => d.kind === kind)) n++;
      }
      return n;
    };
    const plain = output({ references: references(facingA, room(), [0]) });
    for (let seed = 1; seed <= 50; seed++) {
      const fromRich = interpretPhoto(noisy(richScene(), seed, 10), options(rich()), ids());
      expect(corrections(fromRich)).toEqual([]);
      expect(corrections(interpretPhoto(noisy(plain, seed, 10), options(), ids()))).toEqual([]);
    }
    // Measured on these scenes: 48 and 35 of 50.
    expect(found(richScene(), rich(1.0), 'opening')).toBeGreaterThanOrEqual(45);
    expect(found(richScene(2.7), rich(), 'room-ceiling-height')).toBeGreaterThanOrEqual(30);
  });

  it('suggests no correction with fewer than 5 distinct fit points, however large the difference', () => {
    const truth = room({ ceilingHeight: 2.9 });
    // The window's four corners (each reported twice) and the top wall corners.
    const refs = references(facingA, truth, [0], { floor: false }).filter((r) => r.ref !== 'O2');
    const context = room();
    context.openings[0] = { ...context.openings[0]!, width: 0.8 };
    const drafts = interpretPhoto(
      output({
        references: [...refs, ...refs.filter((r) => r.ref === 'O1')],
        features: [feature({ box: deviceBox(facingA, truth, 0, 0.6, 0.3) })],
      }),
      options(context),
      ids(),
    );
    expect(corrections(drafts)).toEqual([]);
    expect(devices(drafts)).toHaveLength(1);
  });

  it('skips corrections already pending', () => {
    const out = richScene(2.7);
    const all = corrections(interpretPhoto(out, options(rich(1.0)), ids()));
    expect(all.map((d) => d.kind)).toEqual(['opening', 'room-ceiling-height']);
    const pending = { openingIds: [OPENING.window], roomIds: [ROOM] };
    expect(corrections(interpretPhoto(out, options(rich(1.0), [], pending), ids()))).toEqual([]);
  });
});

describe('interpretPhoto: de-duplication', () => {
  const truth = room();
  const refs = references(facingA, truth, [0]);
  const outlet = (u: number, partial: Partial<PhotoFeature> = {}) =>
    feature({ box: deviceBox(facingA, truth, 0, u, 0.3), ...partial });
  const existing: Device['placement'] = {
    kind: 'wall',
    wallId: WALL.A,
    offset: 0.6,
    height: 0.3,
    side: 'right',
  };

  it('skips features matched to or near an existing device, or near a pending suggestion', () => {
    const context = room();
    context.devices = [{ id: id(40), domain: 'power', type: 'outlet', placement: existing }];
    const pending = [{ domain: 'power', type: 'outlet', placement: { ...existing, offset: 2.5 } }];
    const out = output({
      references: refs,
      features: [
        outlet(0.6, { existing: 'E1' }),
        outlet(0.8),
        outlet(2.6),
        outlet(1.5),
        feature({ deviceType: 'power.switch', box: deviceBox(facingA, truth, 0, 0.6, 0.3) }),
      ],
    });
    const placed = devices(interpretPhoto(out, options(context, pending), ids()));
    expect(placed.map((d) => [d.type, Math.round(wallPlacement(d).offset * 10) / 10])).toEqual([
      ['outlet', 1.5],
      ['switch', 0.6],
    ]);
  });

  it('keeps close outlets in one photo, dropping only a device reported twice', () => {
    const out = output({
      references: refs,
      features: [outlet(1.5), outlet(1.5), outlet(1.52), outlet(1.7), outlet(1.85)],
    });
    const placed = devices(interpretPhoto(out, options(), ids()));
    expect(placed.map((d) => Math.round(wallPlacement(d).offset * 100) / 100)).toEqual([
      1.5, 1.7, 1.85,
    ]);
  });
});

describe('interpretPhoto: untrusted fits', () => {
  it('flags a fitted point well outside the wall face instead of only clamping it', () => {
    const truth = room();
    const out = output({
      references: references(facingA, truth, [0]),
      features: [
        feature({ box: deviceBox(facingA, truth, 0, 4.4, 0.3) }),
        feature({ box: deviceBox(facingA, truth, 0, 4.15, 0.3) }),
      ],
    });
    const [far, near] = interpretPhoto(out, options(), ids());
    expect(wallPlacement(far!.payload as DevicePayload).offset).toBe(4.05);
    expect(far!.issues).toEqual([{ code: 'photo.position-rough', severity: 'warning' }]);
    expect(far!.confidence).toBeCloseTo(0.9 * ROUGH_CONFIDENCE);
    expect(wallPlacement(near!.payload as DevicePayload).offset).toBe(4.05);
    expect(near!.issues).toEqual([]);
  });

  it('places a whole wall roughly when its fit misses its own points', () => {
    const truth = room();
    // The model has the door a metre from where the photo shows it.
    const context = room();
    context.openings[1] = { ...context.openings[1]!, offset: context.openings[1]!.offset - 1 };
    const out = output({
      references: references(facingA, truth, [0]),
      features: [feature({ box: deviceBox(facingA, truth, 0, 0.6, 0.3) })],
    });
    const [draft] = interpretPhoto(out, options(context), ids());
    expect(draft!.issues).toEqual([{ code: 'photo.position-rough', severity: 'warning' }]);
    expect(wallPlacement(draft!.payload as DevicePayload).height).toBe(0.25);
  });
});

describe('interpretPhoto: device payloads', () => {
  it('builds a device without provenance from the detectable type, with the photo as evidence', () => {
    const truth = room();
    const out = output({
      references: references(facingA, truth, [0]),
      features: [
        feature({ box: deviceBox(facingA, truth, 0, 0.6, 0.3), count: 2 }),
        feature({
          deviceType: 'power.switch',
          box: deviceBox(facingA, truth, 0, 3.9, 1.05),
          count: 2,
          props: [
            { name: 'variant', value: 'double' },
            { name: 'colour', value: 'white' },
          ],
        }),
      ],
    });
    const drafts = interpretPhoto(out, options(), ids());
    const [outlet, light] = drafts.map(
      (d) => kinds.get('device')!.parse(d.payload) as DevicePayload,
    );
    expect(outlet).toMatchObject({
      domain: 'power',
      type: 'outlet',
      label: '',
      roomId: ROOM,
      count: 2,
      props: {},
      attachmentIds: [PHOTO],
    });
    expect(outlet!.ports.map((p) => [p.domain, p.kind])).toEqual([['power', 'power-in']]);
    expect(light).toMatchObject({ type: 'switch', props: { variant: 'double' } });
    expect(light).not.toHaveProperty('count');
    const allIds = drafts.flatMap((d) => [
      d.id,
      (d.payload as DevicePayload).id,
      ...(d.payload as DevicePayload).ports.map((p) => p.id),
    ]);
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

describe('interpretPhoto: ceiling lights', () => {
  const light = (x: number, wall = 'ceiling') =>
    feature({
      deviceType: 'power.ceiling_light',
      wall,
      box: { xmin: x, xmax: x + 40, ymin: 20, ymax: 60 },
    });

  it('puts one ceiling light at the room centroid, flagged rough', () => {
    const drafts = interpretPhoto(output({ features: [light(400)] }), options(), ids());
    expect(drafts).toHaveLength(1);
    const payload = kinds.get('device')!.parse(drafts[0]!.payload) as DevicePayload;
    expect(payload.placement).toEqual({ kind: 'ceiling', roomId: ROOM, at: { x: 2, y: 1.5 } });
    expect(drafts[0]!.issues).toEqual([{ code: 'photo.position-rough', severity: 'warning' }]);
    expect(drafts[0]!.confidence).toBeCloseTo(0.9 * ROUGH_CONFIDENCE);
  });

  it('spreads several along the long axis and leaves the slots of lights already there', () => {
    const two = devices(
      interpretPhoto(output({ features: [light(300), light(600, 'A')] }), options(), ids()),
    );
    expect(two.map((d) => d.placement)).toEqual([
      { kind: 'ceiling', roomId: ROOM, at: { x: 1, y: 1.5 } },
      { kind: 'ceiling', roomId: ROOM, at: { x: 3, y: 1.5 } },
    ]);

    const pending = [
      {
        domain: 'power',
        type: 'ceiling_light',
        placement: { kind: 'ceiling' as const, roomId: ROOM, at: { x: 1.1, y: 1.4 } },
      },
    ];
    const one = devices(
      interpretPhoto(
        output({ features: [light(300), light(600)] }),
        options(room(), pending),
        ids(),
      ),
    );
    expect(one.map((d) => d.placement)).toEqual([
      { kind: 'ceiling', roomId: ROOM, at: { x: 3, y: 1.5 } },
    ]);
  });

  it('never turns a light matched to an existing device into a new one', () => {
    const lightAt = (n: number, at: { x: number; y: number }) => ({
      id: id(n),
      domain: 'power',
      type: 'ceiling_light',
      placement: { kind: 'ceiling' as const, roomId: ROOM, at },
    });
    const context = room();
    context.devices = [lightAt(40, { x: 0.9, y: 1.5 })];
    const matched = { ...light(300), existing: 'E1', confidence: 0.99 };

    expect(
      devices(interpretPhoto(output({ features: [matched] }), options(context), ids())),
    ).toEqual([]);
    const [fresh, ...rest] = interpretPhoto(
      output({ features: [matched, { ...light(600), confidence: 0.7 }] }),
      options(context),
      ids(),
    );
    expect(rest).toEqual([]);
    expect((fresh!.payload as DevicePayload).placement).toMatchObject({ at: { x: 3, y: 1.5 } });
    expect(fresh!.confidence).toBeCloseTo(0.7 * ROUGH_CONFIDENCE);

    // A second light already in the room accounts for the unmatched one.
    context.devices.push(lightAt(41, { x: 3, y: 1.5 }));
    expect(
      devices(interpretPhoto(output({ features: [matched, light(600)] }), options(context), ids())),
    ).toEqual([]);
  });
});
