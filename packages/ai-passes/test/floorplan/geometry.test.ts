import {
  distance,
  imageToWorld,
  pointOnWall,
  signedArea,
  type Opening,
  type Pt,
  type Room,
  type Wall,
} from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import {
  interpretFloorplan,
  joinDoubleOpenings,
  placeDetectedOpening,
  type PlannedOpening,
  type SuggestionDraft,
} from '../../src/index.ts';
import { idSource, optionsFor, output, testPlan } from './fixtures.ts';

const ofKind = <T>(drafts: SuggestionDraft[], kind: string) =>
  drafts.filter((d) => d.kind === kind).map((d) => d.payload as T);
const deg = (w: Wall) => (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI;
const mod90 = (a: number) => ((a % 90) + 90) % 90;
const near = (p: Pt, q: Pt, tolerance: number) => distance(p, q) <= tolerance;

describe('interpretFloorplan geometry', () => {
  for (const rotation of [0, 25]) {
    describe(`on a plan turned ${rotation}°`, () => {
      const plan = testPlan({ rotation });
      const { drafts } = interpretFloorplan(plan.output, optionsFor(plan), idSource());
      const walls = ofKind<Wall>(drafts, 'wall');
      const openings = ofKind<Opening>(drafts, 'opening');
      const rooms = ofKind<Room>(drafts, 'room');

      it('cleans the walls to the six real ones, along the plan’s own axes', () => {
        expect(walls).toHaveLength(6);
        const angles = walls.map((w) => mod90(deg(w) + 45) - 45);
        // Within the millimetre rounding of the end points.
        for (const a of angles) expect(Math.abs(a - angles[0]!)).toBeLessThan(0.01);
        expect(Math.abs(angles[0]! - rotation)).toBeLessThan(rotation === 0 ? 1e-9 : 0.5);
        const corners = [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
          { x: 8, y: 6 },
          { x: 0, y: 6 },
        ].map(plan.toWorld);
        for (const corner of corners) {
          const ends = walls.flatMap((w) => [w.a, w.b]).filter((p) => near(p, corner, 0.15));
          expect(ends.length).toBeGreaterThanOrEqual(2);
          for (const p of ends) expect(p).toEqual(ends[0]);
        }
      });

      it('keeps exterior and interior thickness', () => {
        const thicknesses = walls.map((w) => w.thickness).sort();
        expect(thicknesses).toEqual([0.12, 0.12, 0.3, 0.3, 0.3, 0.3]);
      });

      it('fills the three rooms from their label points', () => {
        expect(rooms.map((r) => r.name)).toEqual(['Vardagsrum', 'Sovrum', 'WC/D']);
        expect(rooms.map((r) => r.type)).toEqual(['living_room', 'bedroom', 'bathroom']);
        const areas = rooms.map((r) => Math.abs(signedArea(r.polygon)));
        expect(areas[0]).toBeCloseTo(30, 0);
        expect(areas[1]).toBeCloseTo(9, 0);
        expect(areas[2]).toBeCloseTo(9, 0);
        for (const d of drafts.filter((d) => d.kind === 'room')) expect(d.issues).toEqual([]);
      });

      it('puts each opening on its wall, as wide as detected', () => {
        expect(openings.map((o) => o.kind).sort()).toEqual(['door', 'door', 'door', 'window']);
        const byWall = new Map(walls.map((w) => [w.id, w]));
        const centres: [Pt, number][] = [
          [{ x: 1.5, y: 6 }, 1],
          [{ x: 5, y: 1.425 }, 0.85],
          [{ x: 6.4, y: 3 }, 0.8],
          [{ x: 2.1, y: 0 }, 1.2],
        ];
        for (const [centre, width] of centres) {
          const world = plan.toWorld(centre);
          const opening = openings.find((o) => {
            const wall = byWall.get(o.wallId)!;
            return near(pointOnWall(wall, o.offset + o.width / 2), world, 0.1);
          });
          expect(opening, `opening at ${centre.x},${centre.y}`).toBeDefined();
          expect(opening!.width).toBeCloseTo(width, 0);
        }
      });

      it('makes each opening require its wall’s suggestion', () => {
        const wallDrafts = new Map(
          drafts.filter((d) => d.kind === 'wall').map((d) => [(d.payload as Wall).id, d.id]),
        );
        for (const d of drafts.filter((d) => d.kind === 'opening')) {
          expect(d.requires).toEqual([wallDrafts.get((d.payload as Opening).wallId)]);
        }
      });

      it('turns the detected hinge and swing into ADR 0006 terms', () => {
        const entrance = openings.find((o) => o.width > 0.95 && o.kind === 'door')!;
        const wall = walls.find((w) => w.id === entrance.wallId)!;
        const hinge = pointOnWall(
          wall,
          entrance.hinge === 'left' ? entrance.offset : entrance.offset + entrance.width,
        );
        expect(near(hinge, plan.toWorld({ x: 1, y: 6 }), 0.1)).toBe(true);
        // The door opens into the flat, which is on the side of the wall away from y = 6 in plan terms.
        const inside = plan.toWorld({ x: 1.5, y: 5 });
        const d = { x: wall.b.x - wall.a.x, y: wall.b.y - wall.a.y };
        const leftSide = d.y * (inside.x - wall.a.x) - d.x * (inside.y - wall.a.y) >= 0;
        expect(entrance.swing).toBe(leftSide ? 'in' : 'out');
      });
    });
  }

  it('flags rooms whose walls do not close and gives them the model’s rough extent', () => {
    const plan = testPlan({ withoutInnerWall: true });
    const output = {
      ...plan.output,
      rooms: plan.output.rooms.map((r) =>
        r.name === 'Sovrum' ? { ...r, box: { xmin: 540, ymin: 260, xmax: 750, ymax: 500 } } : r,
      ),
    };
    const { drafts } = interpretFloorplan(output, optionsFor(plan), idSource());
    const rooms = drafts.filter((d) => d.kind === 'room');
    // Without the wall between them, the bedroom and bathroom labels share one enclosed area.
    const shared = rooms.find((d) => (d.payload as Room).name === 'Sovrum / WC/D')!;
    expect(shared.issues.map((i) => i.code)).toEqual(['ai.room-merged']);

    const open = testPlan();
    const cut = {
      ...open.output,
      walls: open.output.walls.filter((_, i) => i !== 2),
      rooms: open.output.rooms.map((r) =>
        r.name === 'Sovrum' ? { ...r, box: { xmin: 540, ymin: 260, xmax: 750, ymax: 500 } } : r,
      ),
    };
    const result = interpretFloorplan(cut, optionsFor(open), idSource()).drafts.filter(
      (d) => d.kind === 'room',
    );
    for (const d of result.filter((d) => (d.payload as Room).name !== 'Vardagsrum')) {
      expect(d.issues.map((i) => i.code)).toContain('ai.room-open');
      expect(d.confidence).toBeLessThan(0.5);
    }
    const bedroom = result.find((d) => (d.payload as Room).name === 'Sovrum')!;
    const box = (bedroom.payload as Room).polygon;
    expect(box).toHaveLength(4);
    expect(box[0]!.x).toBeCloseTo(0.54 * 1400 * open.metresPerPixel, 6);
    const bathroom = result.find((d) => (d.payload as Room).name === 'WC/D')!;
    expect(Math.abs(signedArea((bathroom.payload as Room).polygon))).toBeCloseTo(4, 6);
  });
});

describe('interpretFloorplan placement', () => {
  it('measures through the background placement and snaps to the page axes as placed', () => {
    const plan = testPlan();
    const placement = {
      offset: { x: 5, y: -2 },
      rotation: 30,
      metresPerPixel: plan.metresPerPixel,
    };
    const { drafts } = interpretFloorplan(plan.output, optionsFor(plan, { placement }), idSource());
    const walls = drafts.filter((d) => d.kind === 'wall').map((d) => d.payload as Wall);
    expect(walls).toHaveLength(6);
    for (const w of walls) expect(Math.abs(mod90(deg(w) + 45) - 45 - 30)).toBeLessThan(0.01);
    const corner = imageToWorld(placement, plan.toPx({ x: 0, y: 0 }));
    expect(walls.some((w) => near(w.a, corner, 0.1) || near(w.b, corner, 0.1))).toBe(true);
  });

  it('clamps coordinates just outside the image onto its edge', () => {
    const plan = testPlan();
    const { drafts } = interpretFloorplan(
      output({
        walls: [{ a: { x: -5, y: 500 }, b: { x: 1005, y: 500 }, exterior: true, thickness: null }],
      }),
      optionsFor(plan),
      idSource(),
    );
    const [wall] = drafts.map((d) => d.payload as Wall);
    const xs = [wall!.a.x, wall!.b.x].sort((a, b) => a - b);
    expect(xs).toEqual([0, plan.imageSize.width * plan.metresPerPixel]);
  });
});

describe('placeDetectedOpening', () => {
  const wall: Wall = {
    id: 'w0',
    a: { x: 0, y: 0 },
    b: { x: 4, y: 0 },
    thickness: 0.2,
    provenance: { status: 'suggested' },
  };
  const across: Wall = { ...wall, id: 'w1', a: { x: 2.05, y: -3 }, b: { x: 2.05, y: 0.3 } };
  const door = (a: Pt, b: Pt) => ({
    kind: 'door' as const,
    a,
    b,
    double: false,
    hinge: 'a' as const,
    swingInto: { x: (a.x + b.x) / 2, y: -0.5 },
  });

  it('projects onto the nearest parallel wall, not a perpendicular one closer to its middle', () => {
    const placed = placeDetectedOpening(
      { w0: wall, w1: across },
      door({ x: 1.6, y: 0.25 }, { x: 2.5, y: 0.25 }),
    )!;
    expect(placed.wallId).toBe('w0');
    expect(placed.offset).toBeCloseTo(1.6, 9);
    expect(placed.width).toBeCloseTo(0.9, 9);
    expect(placed.hinge).toBe('left');
    // y = -0.5 is left of a→b (towards -y with y down), which ADR 0006 calls 'in'.
    expect(placed.swing).toBe('in');
  });

  it('clamps an opening that runs past the wall end inside the wall', () => {
    const placed = placeDetectedOpening({ w0: wall }, door({ x: 3.5, y: 0 }, { x: 4.4, y: 0 }))!;
    expect(placed.offset + placed.width).toBeCloseTo(4, 9);
    expect(placed.width).toBeCloseTo(0.9, 9);
    expect(placed.clamped).toBeCloseTo(0.4, 9);
    const tooWide = placeDetectedOpening({ w0: wall }, door({ x: -1, y: 0 }, { x: 5, y: 0 }))!;
    expect(tooWide.offset).toBe(0);
    expect(tooWide.width).toBeCloseTo(4, 9);
  });

  it('drops an opening with no wall in reach', () => {
    expect(placeDetectedOpening({ w0: wall }, door({ x: 1, y: 2 }, { x: 2, y: 2 }))).toBeNull();
  });
});

describe('joinDoubleOpenings', () => {
  const leaf = (offset: number, extra: Partial<PlannedOpening> = {}): PlannedOpening => ({
    wallId: 'w0',
    kind: 'door',
    offset,
    width: 0.7,
    height: 2.1,
    hinge: 'left',
    double: false,
    distance: 0,
    clamped: 0,
    ...extra,
  });

  it('joins two leaves side by side into one double opening without a hinge', () => {
    const [joined, ...rest] = joinDoubleOpenings([leaf(2.75), leaf(2)]);
    expect(rest).toEqual([]);
    expect(joined).toMatchObject({ offset: 2, double: true });
    expect(joined!.width).toBeCloseTo(1.45, 9);
    expect(joined!.hinge).toBeUndefined();
  });

  it('keeps openings apart on other walls, of other kinds or with a gap', () => {
    expect(
      joinDoubleOpenings([
        leaf(0),
        leaf(0.7, { wallId: 'w1' }),
        leaf(0.7, { kind: 'window' }),
        leaf(2),
      ]),
    ).toHaveLength(4);
  });
});
