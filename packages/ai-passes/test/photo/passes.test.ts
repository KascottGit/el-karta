import { createFakeProvider } from '@el-karta/ai-providers';
import { describe, expect, it } from 'vitest';
import { allPasses, photoPass, runPass, validatePhoto, type PhotoOutput } from '../../src/index.ts';
import { feature, id, input, output, reference, room, WALL } from './fixtures.ts';

const box = { xmin: 100, ymin: 600, xmax: 140, ymax: 650 };
const codes = (out: PhotoOutput, context = room()) =>
  validatePhoto(out, input(context)).map((i) => [i.code, i.params?.['field']]);

describe('validatePhoto', () => {
  it('accepts a well-formed answer', () => {
    const out = output({
      references: [
        reference('wall_corner', 'D', 'top_left', { x: 0, y: 0 }),
        reference('opening_corner', 'O3', 'bottom_right', { x: 1005, y: 1000 }),
      ],
      features: [
        feature({ box, count: 2 }),
        feature({
          deviceType: 'power.switch',
          box,
          props: [{ name: 'variant', value: 'dimmer' }],
        }),
        feature({ deviceType: 'power.ceiling_light', wall: 'ceiling', box }),
        feature({ deviceType: 'power.ceiling_light', wall: 'B', box }),
      ],
    });
    expect(validatePhoto(out, input())).toEqual([]);
  });

  it('flags unknown walls, openings, devices and types', () => {
    const context = room();
    context.devices = [
      {
        id: id(40),
        domain: 'power',
        type: 'outlet',
        placement: { kind: 'wall', wallId: WALL.A, offset: 1, height: 0.3, side: 'right' },
      },
    ];
    expect(
      codes(
        output({
          wall: 'E',
          references: [
            reference('wall_corner', 'O1', 'top_left', { x: 1, y: 1 }),
            reference('opening_corner', 'O4', 'top_left', { x: 1, y: 1 }),
            reference('opening_corner', 'A', 'top_left', { x: 1, y: 1 }),
          ],
          features: [
            feature({ box, existing: 'E1' }),
            feature({ box, existing: 'E2' }),
            feature({ box, wall: 'a' }),
            feature({ box, deviceType: 'outlet' }),
            feature({ box, wall: 'ceiling' }),
          ],
        }),
        context,
      ),
    ).toEqual([
      ['photo.unknown-wall', 'wall'],
      ['photo.unknown-wall', 'references.0'],
      ['photo.unknown-opening', 'references.1'],
      ['photo.unknown-opening', 'references.2'],
      ['photo.unknown-device', 'features.1'],
      ['photo.unknown-wall', 'features.2'],
      ['photo.unknown-device-type', 'features.3'],
      ['photo.wall-type-on-ceiling', 'features.4'],
    ]);
  });

  it('flags points and boxes outside the image, inverted boxes, counts and props', () => {
    expect(
      codes(
        output({
          references: [reference('wall_corner', 'A', 'top_left', { x: -20, y: 500 })],
          features: [
            feature({ box: { ...box, xmax: 1020 } }),
            feature({ box: { ...box, ymax: box.ymin } }),
            feature({ box, deviceType: 'power.switch', count: 1 }),
            feature({ box, count: 0 }),
            feature({
              box,
              deviceType: 'power.switch',
              props: [{ name: 'variant', value: 'triple' }],
            }),
            feature({ box, props: [{ name: 'earthed', value: 'true' }] }),
          ],
        }),
      ),
    ).toEqual([
      ['photo.point-outside', 'references.0'],
      ['photo.box-outside', 'features.0'],
      ['photo.box-inverted', 'features.1'],
      ['photo.count-not-countable', 'features.2'],
      ['photo.count-invalid', 'features.3'],
      ['photo.unknown-prop', 'features.4'],
      ['photo.unknown-prop', 'features.5'],
    ]);
  });

  it('returns only errors, so every issue makes the runner retry', () => {
    const issues = validatePhoto(output({ wall: 'Z' }), input());
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });
});

describe('photoPrompt', () => {
  it('describes walls, openings and devices as seen from the room', () => {
    const context = room({ reverseA: true });
    context.devices = [
      {
        id: id(40),
        domain: 'power',
        type: 'outlet',
        // 0.50 m from the left end of the reversed A (whose `a` is on the right).
        placement: { kind: 'wall', wallId: WALL.A, offset: 3.55, height: 0.3, side: 'left' },
      },
      {
        id: id(41),
        domain: 'power',
        type: 'ceiling_light',
        placement: { kind: 'ceiling', roomId: context.room.id, at: { x: 2, y: 1.5 } },
      },
    ];
    const { system, text, images } = photoPass.prompt({
      ...input(context),
      earlier: [{ mimeType: 'image/jpeg', data: 'BBBB' }],
    });
    expect(system).toContain('normalised to 0–1000');
    expect(text).toContain('Room: "Kök" (kitchen), ceiling height 2.50 m.');
    expect(text).toContain(
      '- A: 4.00 m long; its left end meets wall D, its right end meets wall B.',
    );
    expect(text).toContain(
      '  - O1: window, 1.00–2.20 m from the left end, 0.90–2.10 m above the floor.',
    );
    expect(text).toContain(
      '  - O2: door, 2.95–3.75 m from the left end, 0.00–2.00 m above the floor.',
    );
    expect(text).toContain('  - O3: window, 1.00–2.00 m from the left end');
    expect(text).toContain(
      '- E1: power.outlet on wall A, 0.50 m from the left end, 0.30 m above the floor.',
    );
    expect(text).toContain('- E2: power.ceiling_light on the ceiling.');
    expect(text).toContain('The person says the photo shows wall A.');
    expect(text).toContain('props: variant (single, double, dimmer)');
    expect(text).toContain(
      'The second image is an earlier photo of the same room, for context only',
    );
    expect(images.map((i) => i.data)).toEqual(['AAAA', 'BBBB']);
  });

  it('says when no wall was chosen', () => {
    const { text } = photoPass.prompt({ ...input(), targetWallId: null });
    expect(text).toContain('The person did not say which wall the photo shows.');
    expect(text).toContain('Devices already recorded in this room:\nNone.');
  });
});

describe('photoPass', () => {
  it('is registered for the Edge Function', () => {
    expect(allPasses).toContain(photoPass);
  });

  it('retries once when the answer fails validation, then returns the fixed answer', async () => {
    const bad = output({ features: [feature({ box, wall: 'Q' })] });
    const good = output({ features: [feature({ box })] });
    const provider = createFakeProvider([bad, good]);
    const result = await runPass(photoPass, input(), { provider, model: 'm' });
    expect(result).toMatchObject({ status: 'ok', output: good, validationRetries: 1 });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]!.messages.at(-1)!.text).toContain('photo.unknown-wall');
  });
});
