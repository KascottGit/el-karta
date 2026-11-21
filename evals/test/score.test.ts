import { describe, expect, it } from 'vitest';
import type { FullFacit, LightFacit } from '../floorplan/facit.ts';
import {
  matchRooms,
  readingFromDrafts,
  scoreFloorplan,
  type PlanReading,
} from '../floorplan/score.ts';

const facit = (partial: Partial<LightFacit> = {}): LightFacit => ({
  id: 'test',
  level: 'light',
  checked: true,
  rotationDeg: 0,
  scale: { metresPerImageWidth: 20, evidence: ['ratio'] },
  totalArea: null,
  ceilingHeight: null,
  rooms: [
    { name: 'Vardagsrum', types: ['living_room'], area: 20 },
    { name: 'WC/D', types: ['bathroom'], area: 4 },
    { name: 'Hall/Kokvrå', types: ['hallway', 'kitchen'], area: null },
  ],
  doors: 2,
  ...partial,
});

const square = { a: { x: 0, y: 0 }, b: { x: 5, y: 0 } };
const reading = (partial: Partial<PlanReading> = {}): PlanReading => ({
  rooms: [
    { name: 'Vardagsrum', type: 'living_room', area: 20 },
    { name: 'wc / d', type: 'bathroom', area: 4 },
    { name: 'Hall/Kokvrå', type: 'kitchen', area: 6 },
  ],
  doors: 2,
  windows: 0,
  walls: [square, { a: { x: 5, y: 0 }, b: { x: 5, y: 4 } }],
  metresPerImageWidth: 20,
  ...partial,
});

describe('scoreFloorplan', () => {
  it('scores a perfect reading as perfect', () => {
    const { rotationErrorDeg, ...scores } = scoreFloorplan(facit(), reading(), 'printed');
    expect(rotationErrorDeg).toBeCloseTo(0, 9);
    expect(scores).toEqual({
      roomsExpected: 3,
      roomsFound: 3,
      nameMatch: 1,
      typeAccuracy: 1,
      doorsExpected: 2,
      doorsFound: 2,
      scaleError: 0,
      estimateWithin10: null,
      roomAreaError: 0,
      wallLengthError: null,
    });
  });

  it('counts a missing room against the name match', () => {
    const rooms = reading().rooms.slice(1);
    const scores = scoreFloorplan(facit(), reading({ rooms }), 'printed');
    expect(scores.roomsFound).toBe(2);
    expect(scores.nameMatch).toBeCloseTo(2 / 3);
    expect(scores.typeAccuracy).toBe(1);
  });

  it('counts a wrong type against the type accuracy but not the name match', () => {
    const rooms = reading().rooms.map((r) =>
      r.name === 'Vardagsrum' ? { ...r, type: 'bedroom' as const } : r,
    );
    const scores = scoreFloorplan(facit(), reading({ rooms }), 'printed');
    expect(scores.nameMatch).toBe(1);
    expect(scores.typeAccuracy).toBeCloseTo(2 / 3);
  });

  it('reports a scale 10 % off as a relative error, and an estimate inside the tolerance', () => {
    const off = reading({ metresPerImageWidth: 22 });
    expect(scoreFloorplan(facit(), off, 'printed').scaleError).toBeCloseTo(0.1);
    expect(scoreFloorplan(facit(), off, 'estimate').estimateWithin10).toBe(true);
    const further = reading({ metresPerImageWidth: 22.5 });
    expect(scoreFloorplan(facit(), further, 'estimate').estimateWithin10).toBe(false);
    const none = reading({ metresPerImageWidth: null });
    expect(scoreFloorplan(facit(), none, 'estimate')).toMatchObject({
      scaleError: null,
      estimateWithin10: false,
    });
  });

  it('does not score the scale when the facit has none', () => {
    const scores = scoreFloorplan(facit({ scale: null }), reading(), 'estimate');
    expect(scores.scaleError).toBeNull();
    expect(scores.estimateWithin10).toBeNull();
  });

  it('measures rotation error modulo 90 degrees', () => {
    const turn = (deg: number) => {
      const r = (deg * Math.PI) / 180;
      return { a: { x: 0, y: 0 }, b: { x: Math.cos(r), y: Math.sin(r) } };
    };
    const turned = reading({ walls: [turn(-23)] });
    expect(
      scoreFloorplan(facit({ rotationDeg: -25 }), turned, 'printed').rotationErrorDeg,
    ).toBeCloseTo(2);
    // A wall at 65° is the perpendicular of one at -25°.
    const perpendicular = reading({ walls: [turn(65)] });
    expect(
      scoreFloorplan(facit({ rotationDeg: -25 }), perpendicular, 'printed').rotationErrorDeg,
    ).toBeCloseTo(0);
    expect(scoreFloorplan(facit(), reading({ walls: [] }), 'printed').rotationErrorDeg).toBeNull();
  });

  it('averages the area error of matched rooms that have both areas', () => {
    const rooms = reading().rooms.map((r) => (r.name === 'Vardagsrum' ? { ...r, area: 22 } : r));
    // Vardagsrum 10 % off, WC/D exact, Hall/Kokvrå has no facit area.
    expect(scoreFloorplan(facit(), reading({ rooms }), 'printed').roomAreaError).toBeCloseTo(0.05);
  });

  it('scores total wall length against a full facit', () => {
    const full: FullFacit = {
      ...facit(),
      level: 'full',
      scale: { metresPerImageWidth: 20, evidence: [] },
      image: { width: 1000, height: 800 },
      rooms: [],
      walls: [{ ...square, thickness: 0.2 }],
      openings: [],
      windows: 0,
    };
    expect(scoreFloorplan(full, reading(), 'printed').wallLengthError).toBeCloseTo(9 / 5 - 1);
    const unscaled = reading({ metresPerImageWidth: null });
    expect(scoreFloorplan(full, unscaled, 'printed').wallLengthError).toBeNull();
  });
});

describe('matchRooms', () => {
  it('matches unlabelled facit rooms with any room left, preferring an accepted type', () => {
    const pairs = matchRooms(
      [
        { name: null, types: ['bedroom'], area: null },
        { name: 'Kök', types: ['kitchen'], area: null },
      ],
      [
        { name: 'Kök', type: 'kitchen' as const },
        { name: 'Rum', type: 'living_room' as const },
        { name: 'Rum', type: 'bedroom' as const },
      ],
    );
    expect(pairs.map(([f, r]) => [f.name, r.type])).toEqual([
      ['Kök', 'kitchen'],
      [null, 'bedroom'],
    ]);
  });

  it('uses each found room once', () => {
    const pairs = matchRooms(
      [
        { name: 'Sovrum', types: ['bedroom'], area: null },
        { name: 'Sovrum', types: ['bedroom'], area: null },
      ],
      [{ name: 'Sovrum', type: 'bedroom' as const }],
    );
    expect(pairs).toHaveLength(1);
  });
});

describe('readingFromDrafts', () => {
  const room = (issues: { code: string; severity: 'warning' }[] = []) => ({
    id: crypto.randomUUID(),
    kind: 'room',
    payload: {
      name: 'Kök',
      type: 'kitchen',
      polygon: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 2 },
        { x: 0, y: 2 },
      ],
    },
    issues,
    requires: [],
  });
  const opening = (kind: string) => ({
    id: crypto.randomUUID(),
    kind: 'opening',
    payload: { kind },
    issues: [],
    requires: [],
  });

  it('counts rooms, doors and windows, and measures closed rooms only when scaled', () => {
    const drafts = [
      room(),
      room([{ code: 'ai.room-open', severity: 'warning' }]),
      opening('door'),
      opening('door'),
      opening('window'),
      opening('passage'),
    ];
    const scaled = readingFromDrafts(drafts, 20);
    expect(scaled.rooms.map((r) => r.area)).toEqual([6, null]);
    expect(scaled).toMatchObject({ doors: 2, windows: 1 });
    expect(readingFromDrafts(drafts, null).rooms.map((r) => r.area)).toEqual([null, null]);
  });
});
