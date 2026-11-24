import type { SuggestionDraft } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { photoDetectable } from '../photo/detectable.ts';
import type { FacitDevice, PhotoFacit } from '../photo/facit.ts';
import {
  correctionCount,
  countAccuracy,
  countsByType,
  failedPhotoScores,
  formatCounts,
  foundDevices,
  matchDevices,
  parseCounts,
  scorePhoto,
  type FoundDevice,
} from '../photo/score.ts';

const ROOM = '00000000-0000-4000-8000-000000000001';
const A = '00000000-0000-4000-8000-000000000011';
const B = '00000000-0000-4000-8000-000000000012';

const OUTLET = 'power.outlet';
const SWITCH = 'power.switch';
const LIGHT = 'power.ceiling_light';

/** A kitchen wall with a double outlet, a single outlet and a switch, and a ceiling light. */
const facit = (devices: FacitDevice[] = expected): PhotoFacit => ({
  room: ROOM,
  wall: A,
  devices,
  notes: '',
});
const expected: FacitDevice[] = [
  { type: OUTLET, wall: A, count: 2, offset: 1, height: 1.1 },
  { type: OUTLET, wall: A, count: 1, offset: 2.2, height: 1.1 },
  { type: SWITCH, wall: A, props: { variant: 'single' }, offset: 3.2, height: 1.05 },
  { type: LIGHT, wall: 'ceiling' },
];

const at = (type: string, wall: string, offset?: number, height?: number): FoundDevice => ({
  type,
  wall,
  ...(offset === undefined ? {} : { offset }),
  ...(height === undefined ? {} : { height }),
  props: {},
  rough: false,
});
/** What a perfect pass would find for `expected`. */
const perfect = (): FoundDevice[] => [
  { ...at(OUTLET, A, 1, 1.1), count: 2 },
  { ...at(OUTLET, A, 2.2, 1.1), count: 1 },
  { ...at(SWITCH, A, 3.2, 1.05), props: { variant: 'single' } },
  { ...at(LIGHT, 'ceiling'), rough: true },
];

const score = (found: FoundDevice[], corrections = 0, devices = expected) =>
  scorePhoto(facit(devices), found, corrections, photoDetectable);

describe('scorePhoto', () => {
  it('scores a perfect result as perfect', () => {
    expect(score(perfect(), 1)).toEqual({
      expected: 4,
      found: 4,
      matched: 4,
      precision: 1,
      recall: 1,
      typeAccuracy: 1,
      wallAccuracy: 1,
      countAccuracy: 1,
      countsByType: 'power.ceiling_light=1/1 power.outlet=2/2 power.switch=1/1',
      unitCountAccuracy: 1,
      propsAccuracy: 1,
      meanOffsetError: 0,
      meanHeightError: 0,
      roughShare: 0.25,
      corrections: 1,
    });
  });

  it('counts a missing outlet against recall and the outlet count, not precision', () => {
    // The double outlet at 1.00 m is missed; the one at 2.20 m pairs with its own facit entry.
    const found = perfect().filter((_, i) => i !== 0);
    const s = score(found);
    expect(s).toMatchObject({
      found: 3,
      matched: 3,
      precision: 1,
      recall: 0.75,
      typeAccuracy: 1,
      wallAccuracy: 1,
      countsByType: 'power.ceiling_light=1/1 power.outlet=1/2 power.switch=1/1',
      unitCountAccuracy: 1,
      meanOffsetError: 0,
    });
    expect(s.countAccuracy).toBeCloseTo(1 - 1 / 4, 12);
  });

  it('pairs a device of the wrong type on the right wall and counts it in typeAccuracy', () => {
    const found = perfect();
    found[2] = { ...at(OUTLET, A, 3.2, 1.05), count: 1 };
    const s = score(found);
    expect(s).toMatchObject({
      matched: 4,
      precision: 0.75,
      recall: 0.75,
      typeAccuracy: 0.75,
      wallAccuracy: 1,
      countsByType: 'power.ceiling_light=1/1 power.outlet=3/2 power.switch=0/1',
      // The switch's variant is not compared: it was not found as a switch.
      propsAccuracy: undefined,
    });
    expect(s.countAccuracy).toBeCloseTo(1 - 2 / 5, 12);
  });

  it('pairs the right type on the wrong wall and counts it in wallAccuracy, with no offset error', () => {
    const found = perfect();
    found[2] = { ...at(SWITCH, B, 0.5, 1.05), props: { variant: 'single' } };
    const s = score(found);
    expect(s).toMatchObject({
      matched: 4,
      precision: 0.75,
      recall: 0.75,
      typeAccuracy: 1,
      wallAccuracy: 0.75,
      countAccuracy: 1,
      meanOffsetError: 0,
      meanHeightError: 0,
    });
  });

  it('measures offset and height errors on the pairs, nearest offset first', () => {
    // Found in the other order and off by 0.2 and 0.4 m along the wall, 0.1 m too high.
    const found = [
      { ...at(OUTLET, A, 2.6, 1.2), count: 1 },
      { ...at(OUTLET, A, 1.2, 1.2), count: 2 },
      { ...at(SWITCH, A, 3.2, 1.05), props: { variant: 'double' } },
      at(LIGHT, 'ceiling'),
    ];
    const s = score(found);
    expect(s.meanOffsetError).toBeCloseTo((0.2 + 0.4 + 0) / 3, 12);
    expect(s.meanHeightError).toBeCloseTo((0.1 + 0.1 + 0) / 3, 12);
    expect(s).toMatchObject({ recall: 1, unitCountAccuracy: 1, propsAccuracy: 0 });
  });

  it('leaves offset and height errors out where the facit has none', () => {
    const devices = expected.map(({ type, wall }) => ({ type, wall }));
    const s = score(perfect(), 0, devices);
    expect(s).toMatchObject({
      recall: 1,
      meanOffsetError: undefined,
      meanHeightError: undefined,
      unitCountAccuracy: undefined,
      propsAccuracy: undefined,
    });
  });

  it('scores a photo with nothing to find, and nothing found, as a right count', () => {
    expect(score([], 0, [])).toMatchObject({
      expected: 0,
      found: 0,
      matched: 0,
      precision: undefined,
      recall: undefined,
      typeAccuracy: undefined,
      countAccuracy: 1,
      countsByType: '',
      roughShare: undefined,
    });
  });

  it('has only the expected count for a failed run', () => {
    const s = failedPhotoScores(facit());
    expect(s.expected).toBe(4);
    expect(Object.entries(s).filter(([, v]) => v !== undefined)).toEqual([['expected', 4]]);
  });
});

describe('matchDevices', () => {
  it('prefers same type and wall, then same type, then same wall, each device once', () => {
    const want: FacitDevice[] = [
      { type: OUTLET, wall: A },
      { type: SWITCH, wall: A },
      { type: OUTLET, wall: B },
    ];
    const found = [at(SWITCH, B), at(OUTLET, A), at(OUTLET, A)];
    expect(matchDevices(want, found)).toEqual([
      { expected: 0, found: 1, typeRight: true, wallRight: true },
      { expected: 1, found: 0, typeRight: true, wallRight: false },
      { expected: 2, found: 2, typeRight: true, wallRight: false },
    ]);
  });

  it('pairs devices with a known offset before those without', () => {
    const want: FacitDevice[] = [
      { type: OUTLET, wall: A },
      { type: OUTLET, wall: A, offset: 1 },
    ];
    const found = [at(OUTLET, A, 3), at(OUTLET, A, 1.1)];
    expect(matchDevices(want, found).map((p) => [p.expected, p.found])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe('counts', () => {
  it('formats per type and parses back', () => {
    const counts = countsByType([{ type: SWITCH }, { type: OUTLET }], [{ type: OUTLET }]);
    const text = formatCounts(counts);
    expect(text).toBe('power.outlet=1/1 power.switch=0/1');
    expect(parseCounts(text)).toEqual(counts);
    expect(parseCounts('')).toEqual(new Map());
    expect(countAccuracy(counts.values())).toBe(0.5);
  });
});

describe('foundDevices and correctionCount', () => {
  const draft = (kind: string, payload: unknown, rough = false): SuggestionDraft => ({
    id: '00000000-0000-4000-8000-000000000099',
    kind,
    payload,
    issues: rough ? [{ code: 'photo.position-rough', severity: 'warning' }] : [],
    requires: [],
  });

  it('reads the device suggestions and counts the corrections', () => {
    const drafts = [
      draft(
        'device',
        {
          domain: 'power',
          type: 'outlet',
          placement: { kind: 'wall', wallId: A, offset: 1, height: 0.25, side: 'right' },
          count: 2,
          props: {},
        },
        true,
      ),
      draft('device', {
        domain: 'power',
        type: 'ceiling_light',
        placement: { kind: 'ceiling', roomId: ROOM, at: { x: 2, y: 1.5 } },
        props: {},
      }),
      draft('opening', { id: B }),
      draft('room-ceiling-height', { roomId: ROOM, ceilingHeight: 2.5 }),
    ];
    expect(foundDevices(drafts)).toEqual([
      { type: OUTLET, wall: A, offset: 1, height: 0.25, count: 2, props: {}, rough: true },
      { type: LIGHT, wall: 'ceiling', props: {}, rough: false },
    ]);
    expect(correctionCount(drafts)).toBe(2);
  });
});
