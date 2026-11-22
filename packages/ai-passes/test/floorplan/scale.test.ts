import { distance, type Opening, type Pt, type Wall } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import {
  collapseEvidence,
  estimateFrom,
  interpretFloorplan,
  largestAgreement,
  outputToNorm,
  outputToPixels,
  parseRatio,
  printedCandidates,
  resolveScale,
  STANDARD_SIZES,
  type FloorplanOutput,
  type FloorplanSuggestOptions,
  type StandardObjectType,
} from '../../src/index.ts';
import { idSource, output, page, testPlan } from './fixtures.ts';

// 0.02 m per pixel, unlike the 0.01 default placement, so a wrong fallback shows.
const MPP = 0.02;
const plan = testPlan({ metresPerPixel: MPP });
const options = (extra: Partial<FloorplanSuggestOptions> = {}): FloorplanSuggestOptions => ({
  frame: plan.frame,
  imageSize: plan.imageSize,
  placement: { offset: { x: 0, y: 0 }, rotation: 0, metresPerPixel: 0.01 },
  allowEstimate: false,
  ...extra,
});
const run = (extra: Partial<FloorplanOutput>, opts: Partial<FloorplanSuggestOptions> = {}) =>
  interpretFloorplan({ ...plan.output, ...extra }, options(opts), idSource());
const scaleDraft = (result: ReturnType<typeof run>) =>
  result.drafts.find((d) => d.kind === 'scale');
/** The whole page is 1400 px = 28 m wide, so at 1:100 it is 280 mm. */
const pdfPageWidthMm = 280;
const dimension = (value: number, unit: 'mm' | 'cm' | 'm', a: Pt, b: Pt) => ({
  value,
  unit,
  a: plan.norm(a),
  b: plan.norm(b),
});
const scaleBar = {
  unit: 'm' as const,
  ticks: [0, 1, 2, 5].map((value) => ({ value, point: plan.norm({ x: value, y: 7 }) })),
};
const standard = (type: StandardObjectType, factor = 1) => ({
  type,
  a: plan.norm({ x: 1, y: 1 }),
  b: plan.norm({ x: 1 + STANDARD_SIZES[type] * factor, y: 1 }),
});

describe('parseRatio', () => {
  it('reads the denominator of printed ratios', () => {
    expect(parseRatio('Skala 1:100 (A4)')).toBe(100);
    expect(parseRatio('1 : 50')).toBe(50);
    expect(parseRatio('SKALA 1:1 000')).toBe(1000);
    expect(parseRatio('Skala')).toBeNull();
    expect(parseRatio(null)).toBeNull();
  });
});

describe('printed scale', () => {
  it('comes from a printed ratio and the PDF page width', () => {
    const result = run({ scaleText: 'Skala 1:100' }, { pdfPageWidthMm });
    expect(result.scale.status).toBe('printed');
    const draft = scaleDraft(result)!;
    expect(draft.payload).toEqual({
      source: 'dimension_text',
      metresPerPixel: expect.closeTo(MPP, 9) as number,
    });
    expect(draft.confidence).toBe(0.8);
    // Geometry is measured at that scale: the top wall is 8 m long.
    const walls = result.drafts.filter((d) => d.kind === 'wall');
    const longest = Math.max(
      ...walls.map((d) => distance((d.payload as Wall).a, (d.payload as Wall).b)),
    );
    expect(longest).toBeCloseTo(8, 1);
    for (const w of walls) expect(w.requires).toEqual([draft.id]);
  });

  it('takes a printed paper size over the PDF page, in the image’s orientation', () => {
    const [candidate] = printedCandidates(output({ scaleText: '1:100', paperSize: 'A4' }), {
      imageSize: { width: 1400, height: 1000 },
      pdfPageWidthMm: 420,
    });
    expect(candidate!.metresPerPixel).toBeCloseTo((0.297 * 100) / 1400, 12);
    const [portrait] = printedCandidates(output({ scaleText: '1:100', paperSize: 'A4' }), {
      imageSize: { width: 1000, height: 1400 },
    });
    expect(portrait!.metresPerPixel).toBeCloseTo((0.21 * 100) / 1000, 12);
    expect(
      printedCandidates(output({ scaleText: '1:100' }), {
        imageSize: { width: 1000, height: 1400 },
      }),
    ).toEqual([]);
  });

  it('uses the median of a ratio, a dimension text and a scale bar that agree', () => {
    const result = run(
      {
        scaleText: '1:100',
        dimensions: [dimension(8000, 'mm', { x: 0, y: 0 }, { x: 8.1, y: 0 })],
        scaleBar,
      },
      { pdfPageWidthMm },
    );
    expect(result.scale.candidates.map((c) => c.evidence)).toEqual([
      'ratio',
      'dimension',
      'scale_bar',
    ]);
    expect(scaleDraft(result)!.payload).toEqual({
      source: 'dimension_text',
      metresPerPixel: expect.closeTo(MPP, 9) as number,
    });
    expect(scaleDraft(result)!.confidence).toBe(0.95);
    expect(scaleDraft(result)!.issues).toEqual([]);
  });

  it('flags an outlier but keeps the agreeing majority', () => {
    const result = run(
      {
        scaleText: '1:100',
        dimensions: [dimension(4000, 'mm', { x: 0, y: 0 }, { x: 8, y: 0 })],
        scaleBar,
      },
      { pdfPageWidthMm },
    );
    const draft = scaleDraft(result)!;
    expect((draft.payload as { metresPerPixel: number }).metresPerPixel).toBeCloseTo(MPP, 9);
    expect(draft.issues).toEqual([
      { code: 'ai.scale-disagreement', severity: 'warning', params: { outliers: 1, agreeing: 2 } },
    ]);
  });

  it('suggests no printed scale when two printed values disagree', () => {
    const result = run(
      { scaleText: '1:100', dimensions: [dimension(4000, 'mm', { x: 0, y: 0 }, { x: 8, y: 0 })] },
      { pdfPageWidthMm },
    );
    expect(result.scale.status).toBe('none');
    expect(result.scale.issues.map((i) => i.code)).toEqual(['ai.scale-disagreement']);
    expect(scaleDraft(result)).toBeUndefined();
    for (const d of result.drafts) expect(d.requires.length).toBeLessThanOrEqual(1);
    expect(
      result.drafts.filter((d) => d.kind === 'wall').every((d) => d.requires.length === 0),
    ).toBe(true);
  });

  // Net areas inside the walls of the 8 × 6 m flat (0.3 m exterior, 0.12 m interior walls).
  const living = 4.79 * 5.7;
  const small = 2.79 * 2.79;
  const withAreas = (factor: number) =>
    plan.output.rooms.map((r) => ({
      ...r,
      area: (r.name === 'Vardagsrum' ? living : small) * factor,
    }));

  it('counts room and total areas as one piece of evidence, confirmed by a scale bar', () => {
    const result = run({ rooms: withAreas(1), totalArea: living + 2 * small, scaleBar });
    expect(result.scale.status).toBe('printed');
    const evidence = result.scale.candidates.map((c) => c.evidence);
    expect(evidence.filter((e) => e === 'room_area')).toHaveLength(3);
    expect(evidence).toContain('total_area');
    expect(collapseEvidence(result.scale.candidates).map((c) => c.evidence)).toEqual([
      'scale_bar',
      'total_area',
    ]);
    const draft = scaleDraft(result)!;
    expect(draft.confidence).toBe(0.95);
    const mpp = (draft.payload as { metresPerPixel: number }).metresPerPixel;
    expect(Math.abs(mpp / MPP - 1)).toBeLessThan(0.03);
    const rooms = result.drafts.filter((d) => d.kind === 'room');
    for (const room of rooms) expect(room.issues).toEqual([]);
  });

  it('does not take printed areas alone as a scale, since they depend on the detected walls', () => {
    const result = run({ rooms: withAreas(1), totalArea: living + 2 * small });
    expect(result.scale.status).toBe('none');
    expect(result.scale.issues).toEqual([]);
  });

  it('does not trust a total area when a room is not measured', () => {
    const rooms = withAreas(1).map((r) => (r.name === 'Sovrum' ? { ...r, area: null } : r));
    const walls = plan.output.walls.filter((_, i) => i !== 2);
    const result = run({ rooms, walls, totalArea: living + 2 * small });
    expect(result.scale.candidates.map((c) => c.evidence)).not.toContain('total_area');
  });

  it('does not let many room areas outvote a printed ratio', () => {
    // Areas four times too large imply a scale twice too large.
    const result = run({ scaleText: '1:100', rooms: withAreas(4) }, { pdfPageWidthMm });
    expect(result.scale.status).toBe('none');
    expect(result.scale.issues).toEqual([
      { code: 'ai.scale-disagreement', severity: 'warning', params: { outliers: 2, agreeing: 0 } },
    ]);
    expect(scaleDraft(result)).toBeUndefined();
  });

  it('flags a room whose area does not match its printed area', () => {
    const rooms = withAreas(1).map((r) => (r.name === 'Sovrum' ? { ...r, area: 12 } : r));
    const result = run({ rooms }, { existingScale: { source: 'user', metresPerPixel: MPP } });
    const flagged = result.drafts.filter((d) =>
      d.issues.some((i) => i.code === 'ai.room-area-mismatch'),
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.payload).toMatchObject({ name: 'Sovrum' });
  });
});

describe('the scale chain', () => {
  it('keeps a user scale and suggests no other', () => {
    const result = run(
      { scaleText: '1:150' },
      { pdfPageWidthMm, existingScale: { source: 'user', metresPerPixel: MPP } },
    );
    expect(result.scale.status).toBe('user');
    expect(scaleDraft(result)).toBeUndefined();
    const walls = result.drafts.filter((d) => d.kind === 'wall');
    const longest = Math.max(
      ...walls.map((d) => distance((d.payload as Wall).a, (d.payload as Wall).b)),
    );
    expect(longest).toBeCloseTo(8, 1);
  });

  it('does not suggest a printed scale the floor already has', () => {
    const result = run(
      { scaleText: '1:100' },
      { pdfPageWidthMm, existingScale: { source: 'dimension_text', metresPerPixel: MPP * 1.001 } },
    );
    expect(result.scale.status).toBe('printed');
    expect(scaleDraft(result)).toBeUndefined();
  });

  it('estimates from standard objects only when allowed', () => {
    const objects = [
      standard('interior_door_leaf'),
      standard('wardrobe'),
      standard('double_bed'),
      standard('toilet'),
    ];
    expect(run({ standardObjects: objects }).scale.status).toBe('none');
    const result = run({ standardObjects: objects }, { allowEstimate: true });
    expect(result.scale.status).toBe('estimate');
    const draft = scaleDraft(result)!;
    expect(draft.payload).toEqual({
      source: 'ai_estimate',
      metresPerPixel: expect.closeTo(MPP, 9) as number,
    });
    expect(draft.confidence).toBeCloseTo(0.6, 9);
  });

  it('gives an estimate less confidence the more its objects disagree', () => {
    const tight = estimateFrom(
      [1, 1.02, 0.98, 1.01].map((f) => ({ evidence: 'standard_object', metresPerPixel: MPP * f })),
    )!;
    const loose = estimateFrom(
      [1, 1.2, 0.8, 1.1].map((f) => ({ evidence: 'standard_object', metresPerPixel: MPP * f })),
    )!;
    const single = estimateFrom([{ evidence: 'standard_object', metresPerPixel: MPP }])!;
    expect(tight.confidence).toBeGreaterThan(loose.confidence);
    expect(loose.confidence).toBeGreaterThan(0.05);
    expect(single.confidence).toBeLessThan(tight.confidence);
    expect(tight.confidence).toBeLessThanOrEqual(0.6);
  });

  it('prefers printed information over an estimate', () => {
    const result = run(
      { scaleText: '1:100', standardObjects: [standard('wardrobe', 2)] },
      { pdfPageWidthMm, allowEstimate: true },
    );
    expect(result.scale.status).toBe('printed');
  });

  it('keeps an earlier scale when nothing new is found', () => {
    const existing = { source: 'ai_estimate' as const, metresPerPixel: MPP };
    const result = resolveScale([], [], { existing, allowEstimate: false });
    expect(result).toMatchObject({ status: 'existing', scale: existing, suggest: false });
  });
});

describe('door width sanity', () => {
  it('flags doors and the scale when the scale makes doors implausible', () => {
    // Objects drawn at half their size give a scale half the real one, so doors come out ~0.45 m.
    const result = run(
      { standardObjects: [standard('wardrobe', 0.5), standard('double_bed', 0.5)] },
      { allowEstimate: true },
    );
    const doors = result.drafts.filter(
      (d) => d.kind === 'opening' && (d.payload as Opening).kind === 'door',
    );
    expect(doors).toHaveLength(3);
    for (const d of doors) {
      expect(d.issues.map((i) => i.code)).toEqual(['scale.door-width-implausible']);
      expect(d.confidence).toBe(0.5);
    }
    expect(scaleDraft(result)!.issues.map((i) => i.code)).toEqual(['scale.door-width-implausible']);
  });

  it('does not flag plausible doors', () => {
    const result = run({ scaleText: '1:100' }, { pdfPageWidthMm });
    for (const d of result.drafts) expect(d.issues).toEqual([]);
  });
});

describe('agreement', () => {
  const at = (factors: number[], evidence: 'ratio' | 'dimension' | 'scale_bar' = 'dimension') =>
    factors.map((f) => ({ evidence, metresPerPixel: MPP * f }));

  it('means the largest value is at most 5 % above the smallest', () => {
    expect(largestAgreement(at([1, 1.04]))).toHaveLength(2);
    expect(largestAgreement(at([1, 1.06]))).toHaveLength(1);
    // Each is within 5 % of the middle one, but not of each other.
    expect(largestAgreement(at([1, 1.04, 1.08]))).toHaveLength(2);
    expect(resolveScale(at([1, 1.06]), [], { allowEstimate: false }).status).toBe('none');
  });

  it('breaks ties by the most reliable evidence', () => {
    const group = largestAgreement([
      ...at([1, 1.01], 'dimension'),
      { evidence: 'scale_bar', metresPerPixel: MPP * 2 },
      { evidence: 'ratio', metresPerPixel: MPP * 2.02 },
    ]);
    expect(group.map((c) => c.evidence).sort()).toEqual(['ratio', 'scale_bar']);
  });
});

describe('evidence printed on the page outside the plan', () => {
  // The detail call is sent only the plan with a margin; the legend lies below it.
  const crop = { x: 450, y: 400, width: 500, height: 400 };
  const cropped = outputToNorm(outputToPixels(plan.output, plan.frame), crop);
  const cut = (extra: Partial<FloorplanOutput>, opts: Partial<FloorplanSuggestOptions> = {}) =>
    interpretFloorplan({ ...cropped, ...extra }, options({ frame: crop, ...opts }), idSource());
  // 0 and 5 m on a bar in the legend, in full-image pixels, 1000 px down: outside the crop.
  const legendBar = {
    unit: 'm' as const,
    ticks: [
      { value: 0, point: { x: 100, y: 1000 } },
      { value: 5, point: { x: 100 + 5 / MPP, y: 1000 } },
    ],
  };

  it('gives a printed scale from a scale bar outside the crop', () => {
    const result = cut({}, { page: page({ scaleBar: legendBar }) });
    expect(result.scale.status).toBe('printed');
    expect(result.scale.candidates.map((c) => c.evidence)).toEqual(['scale_bar']);
    expect(result.scale.scale?.metresPerPixel).toBeCloseTo(MPP, 9);
    // Without the page evidence nothing printed is left.
    expect(cut({}).scale.status).toBe('none');
  });

  it('gives a printed scale from a ratio in the title block and the PDF page width', () => {
    const result = cut({}, { page: page({ scaleText: 'Skala 1:100' }), pdfPageWidthMm });
    expect(result.scale.status).toBe('printed');
    expect(result.scale.scale?.metresPerPixel).toBeCloseTo(MPP, 9);
  });

  it('fills only what the detail call left null; its own values win', () => {
    const evidence = page({ scaleText: 'Skala 1:50', ceilingHeight: 2.4, scaleBar: legendBar });
    const result = cut(
      { scaleText: '1:100', ceilingHeight: 2.6 },
      { page: evidence, pdfPageWidthMm },
    );
    // The detail call's 1:100 agrees with the page's scale bar; the page's 1:50 is not used.
    expect(result.scale.candidates.map((c) => c.evidence)).toEqual(['ratio', 'scale_bar']);
    expect(result.scale.issues).toEqual([]);
    expect(result.scale.scale?.metresPerPixel).toBeCloseTo(MPP, 9);
    const height = (r: typeof result) => r.drafts.find((d) => d.kind === 'floor-height')?.payload;
    expect(height(result)).toEqual({ height: 2.6 });
    expect(height(cut({}, { page: evidence }))).toEqual({ height: 2.4 });
  });
});

describe('a printed ratio on an image that is not a PDF page', () => {
  it('needs the printed paper size and is marked unconfirmed', () => {
    expect(run({ scaleText: '1:100' }).scale.status).toBe('none');
    // 1400 px landscape image read as A3 at 1:100: 0.42 m × 100 / 1400 px.
    const result = run({ scaleText: '1:100', paperSize: 'A3' });
    const draft = scaleDraft(result)!;
    expect((draft.payload as { metresPerPixel: number }).metresPerPixel).toBeCloseTo(0.03, 9);
    expect(draft.confidence).toBe(0.5);
    expect(draft.issues.map((i) => i.code)).toContain('ai.scale-unconfirmed');
  });

  it('is confirmed by agreeing evidence', () => {
    const result = run({
      scaleText: '1:100',
      paperSize: 'A3',
      scaleBar: {
        unit: 'm',
        ticks: [0, 1.5, 3, 7.5].map((value) => ({
          value,
          point: plan.norm({ x: value / 1.5, y: 7 }),
        })),
      },
    });
    const draft = scaleDraft(result)!;
    expect(draft.confidence).toBe(0.95);
    expect(draft.issues.map((x) => x.code)).not.toContain('ai.scale-unconfirmed');
  });

  it('is the PDF page width when there is one and no paper size', () => {
    expect(scaleDraft(run({ scaleText: '1:100' }, { pdfPageWidthMm }))!.issues).toEqual([]);
  });
});

describe('without a scale', () => {
  it('flags every wall and room as measured at an unknown scale, with low confidence', () => {
    const result = run({});
    expect(result.scale.status).toBe('none');
    const measured = result.drafts.filter((d) => d.kind === 'wall' || d.kind === 'room');
    expect(measured.length).toBe(9);
    for (const d of measured) {
      expect(d.issues.map((i) => i.code)).toContain('ai.scale-unknown');
      expect(d.confidence).toBeLessThanOrEqual(0.3);
    }
  });

  it('does not flag them when the scale is known', () => {
    const result = run({}, { existingScale: { source: 'user', metresPerPixel: MPP } });
    for (const d of result.drafts)
      expect(d.issues.map((i) => i.code)).not.toContain('ai.scale-unknown');
  });
});

describe('suggestions measured at a suggested scale', () => {
  it('require it: walls and rooms directly, openings through their wall', () => {
    const result = run({ scaleText: '1:100' }, { pdfPageWidthMm });
    const scale = scaleDraft(result)!;
    for (const d of result.drafts.filter((d) => d.kind === 'wall' || d.kind === 'room'))
      expect(d.requires).toEqual([scale.id]);
    expect(result.drafts.filter((d) => d.kind === 'room')).toHaveLength(3);
  });
});

describe('openings that fit no wall', () => {
  it('are reported with their count on the interpretation and the scale draft', () => {
    const stray = {
      kind: 'window' as const,
      a: plan.norm({ x: 2, y: 9 }),
      b: plan.norm({ x: 3, y: 9 }),
      double: false,
      hinge: null,
      swingInto: null,
    };
    const result = run(
      { scaleText: '1:100', openings: [...plan.output.openings, stray] },
      { pdfPageWidthMm },
    );
    const issue = { code: 'ai.opening-unplaced', severity: 'warning', params: { count: 1 } };
    expect(result.issues).toEqual([issue]);
    expect(scaleDraft(result)!.issues).toContainEqual(issue);
    expect(result.drafts.filter((d) => d.kind === 'opening')).toHaveLength(4);
    expect(run({ scaleText: '1:100' }, { pdfPageWidthMm }).issues).toEqual([]);
  });
});
