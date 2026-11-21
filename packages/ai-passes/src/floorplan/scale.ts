import { metresPerPixelFrom, type FloorScale, type SuggestionIssue } from '@el-karta/core';
import type { FloorplanOutput, LengthUnit, PaperSize, StandardObjectType } from './schema.ts';

/** What a scale candidate was computed from, most reliable first (the tie-break order). */
export const SCALE_EVIDENCE = [
  'ratio',
  'dimension',
  'scale_bar',
  'total_area',
  'room_area',
  'standard_object',
] as const;
export type ScaleEvidence = (typeof SCALE_EVIDENCE)[number];

export interface ScaleCandidate {
  evidence: ScaleEvidence;
  metresPerPixel: number;
  /**
   * A ratio read against a printed paper size on an image that is not a PDF page, so nothing
   * confirms that the image spans the whole paper.
   */
  unconfirmed?: boolean;
}

/**
 * Typical real size in metres of the dimension the prompt asks for per object type. Interior door
 * leaves are 0.8–0.9 m in Swedish homes; a wardrobe ("G") unit is 0.6 m wide; beds are measured
 * along their length.
 */
export const STANDARD_SIZES: Readonly<Record<StandardObjectType, number>> = {
  interior_door_leaf: 0.85,
  entrance_door: 1.0,
  wardrobe: 0.6,
  kitchen_counter_depth: 0.6,
  single_bed: 2.0,
  double_bed: 2.0,
  toilet: 0.65,
  bathtub: 1.7,
};

/** ISO 216 paper, short and long side in millimetres. */
export const PAPER_MM: Readonly<Record<PaperSize, readonly [number, number]>> = {
  A0: [841, 1189],
  A1: [594, 841],
  A2: [420, 594],
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
};

/** Printed values within this fraction of each other agree (decision 2). */
export const PRINTED_AGREEMENT = 0.05;

/** Printed evidence that is enough on its own; areas depend on the detected walls. */
const LONE_EVIDENCE: ReadonlySet<ScaleEvidence> = new Set(['ratio', 'dimension', 'scale_bar']);

/** A suggested scale this close to the floor's current one is not worth suggesting. */
const SAME_SCALE = 0.005;

const METRES: Readonly<Record<LengthUnit, number>> = { mm: 0.001, cm: 0.01, m: 1 };
export const toMetres = (value: number, unit: LengthUnit) => value * METRES[unit];

/** The denominator of a printed ratio such as "Skala 1:100 (A4)", or null. */
export function parseRatio(text: string | null): number | null {
  const match = text?.match(/1\s*[:/]\s*(\d+(?:[ .]\d{3})*)/);
  if (!match) return null;
  const n = Number(match[1]!.replace(/[ .]/g, ''));
  return n > 0 ? n : null;
}

export interface ScaleContext {
  /** The full background image in pixels. */
  imageSize: { width: number; height: number };
  /** Width of the PDF page in millimetres, when the background is a rendered PDF page. */
  pdfPageWidthMm?: number | undefined;
}

/**
 * The paper width the image spans: a printed paper size (in the image's orientation) wins, because
 * the ratio refers to that paper even if the file's page is another size; otherwise the PDF page.
 */
function pageWidthMm(
  paper: PaperSize | null,
  context: ScaleContext,
): { mm: number; unconfirmed: boolean } | null {
  const pdf = context.pdfPageWidthMm;
  if (paper) {
    const [short, long] = PAPER_MM[paper];
    const mm = context.imageSize.width > context.imageSize.height ? long : short;
    return { mm, unconfirmed: pdf === undefined };
  }
  return pdf === undefined ? null : { mm: pdf, unconfirmed: false };
}

/** Candidates from printed information that needs no room geometry. Points are full-image pixels. */
export function printedCandidates(px: FloorplanOutput, context: ScaleContext): ScaleCandidate[] {
  const out: ScaleCandidate[] = [];
  const ratio = parseRatio(px.scaleText);
  const page = pageWidthMm(px.paperSize, context);
  if (ratio !== null && page !== null && context.imageSize.width > 0)
    out.push({
      evidence: 'ratio',
      metresPerPixel: ((page.mm / 1000) * ratio) / context.imageSize.width,
      ...(page.unconfirmed ? { unconfirmed: true } : {}),
    });
  for (const d of px.dimensions) {
    const mpp = metresPerPixelFrom(d.a, d.b, toMetres(d.value, d.unit));
    if (mpp !== null) out.push({ evidence: 'dimension', metresPerPixel: mpp });
  }
  const ticks = px.scaleBar?.ticks ?? [];
  if (px.scaleBar && ticks.length >= 2) {
    const sorted = [...ticks].sort((p, q) => p.value - q.value);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const mpp = metresPerPixelFrom(
      first.point,
      last.point,
      toMetres(last.value - first.value, px.scaleBar.unit),
    );
    if (mpp !== null) out.push({ evidence: 'scale_bar', metresPerPixel: mpp });
  }
  return out;
}

export interface RoomAreaSample {
  printedArea: number | null;
  outdoor: boolean;
  /** The room's net floor area in square pixels, or null when its walls do not close. */
  pixelArea: number | null;
}

/** Candidates from printed room areas and the printed total against the rooms' pixel areas. */
export function areaCandidates(
  rooms: readonly RoomAreaSample[],
  totalArea: number | null,
): ScaleCandidate[] {
  const out: ScaleCandidate[] = [];
  const fromArea = (m2: number, px2: number) => Math.sqrt(m2 / px2);
  for (const room of rooms) {
    if (room.printedArea !== null && room.printedArea > 0 && room.pixelArea && room.pixelArea > 0)
      out.push({
        evidence: 'room_area',
        metresPerPixel: fromArea(room.printedArea, room.pixelArea),
      });
  }
  const indoor = rooms.filter((r) => !r.outdoor);
  if (totalArea !== null && totalArea > 0 && indoor.length > 0) {
    // A printed total only matches when every indoor room is measured.
    if (indoor.every((r) => r.pixelArea !== null && r.pixelArea > 0)) {
      const sum = indoor.reduce((s, r) => s + r.pixelArea!, 0);
      out.push({ evidence: 'total_area', metresPerPixel: fromArea(totalArea, sum) });
    }
  }
  return out;
}

/** Candidates from objects of standard size. Points are full-image pixels. */
export function estimateCandidates(px: FloorplanOutput): ScaleCandidate[] {
  return px.standardObjects.flatMap((o) => {
    const mpp = metresPerPixelFrom(o.a, o.b, STANDARD_SIZES[o.type]);
    return mpp === null ? [] : [{ evidence: 'standard_object' as const, metresPerPixel: mpp }];
  });
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const rank = (c: ScaleCandidate) => SCALE_EVIDENCE.indexOf(c.evidence);

const isArea = (c: ScaleCandidate) => c.evidence === 'room_area' || c.evidence === 'total_area';

/**
 * Room and total areas all come from the same detected walls, so they count as one candidate (their
 * median) and many rooms cannot outvote one independent reading such as a ratio. Other kinds are
 * independent readings of the print and stay separate.
 */
export function collapseEvidence(candidates: readonly ScaleCandidate[]): ScaleCandidate[] {
  const areas = candidates.filter(isArea);
  if (areas.length === 0) return [...candidates];
  const area: ScaleCandidate = {
    evidence: areas.some((c) => c.evidence === 'total_area') ? 'total_area' : 'room_area',
    metresPerPixel: median(areas.map((c) => c.metresPerPixel)),
  };
  return [...candidates.filter((c) => !isArea(c)), area];
}

/**
 * The largest group of candidates whose largest value is at most `PRINTED_AGREEMENT` above its
 * smallest; ties go to the group with the most reliable evidence.
 */
export function largestAgreement(candidates: readonly ScaleCandidate[]): ScaleCandidate[] {
  const limit = Math.log(1 + PRINTED_AGREEMENT) + 1e-12;
  const sorted = [...candidates].sort((a, b) => a.metresPerPixel - b.metresPerPixel);
  const bestRank = (g: readonly ScaleCandidate[]) => Math.min(...g.map(rank));
  let best: ScaleCandidate[] = [];
  let start = 0;
  for (let end = 0; end < sorted.length; end++) {
    while (Math.log(sorted[end]!.metresPerPixel / sorted[start]!.metresPerPixel) > limit) start++;
    const group = sorted.slice(start, end + 1);
    if (
      group.length > best.length ||
      (group.length === best.length && bestRank(group) < bestRank(best))
    )
      best = group;
  }
  return best;
}

/**
 * An estimate from standard objects, or null without any. Confidence stays below a printed scale's
 * and falls with the spread (median absolute deviation in log space) and with few objects.
 */
export function estimateFrom(
  candidates: readonly ScaleCandidate[],
): { metresPerPixel: number; confidence: number } | null {
  if (candidates.length === 0) return null;
  const logs = candidates.map((c) => Math.log(c.metresPerPixel));
  const centre = median(logs);
  const spread = median(logs.map((l) => Math.abs(l - centre)));
  const countFactor = candidates.length >= 3 ? 1 : candidates.length === 2 ? 0.8 : 0.6;
  const confidence = 0.6 * Math.max(0, 1 - spread / 0.2) * countFactor;
  return { metresPerPixel: Math.exp(centre), confidence: Math.max(0.05, confidence) };
}

export type ScaleStatus = 'user' | 'printed' | 'estimate' | 'existing' | 'none';

export interface ScaleResolution {
  /**
   * `user`: the floor's user scale is kept. `printed`: from printed information. `estimate`: from
   * standard objects. `existing`: nothing new, the floor's earlier scale is kept. `none`: no scale;
   * the import should ask for a measurement or offer to estimate.
   */
  status: ScaleStatus;
  /** The scale the geometry is built with; null means the placement's own `metresPerPixel`. */
  scale: FloorScale | null;
  /** Whether `scale` is new and should become a scale suggestion. */
  suggest: boolean;
  confidence: number;
  candidates: ScaleCandidate[];
  issues: SuggestionIssue[];
}

export interface ResolveScaleOptions {
  existing?: FloorScale | undefined;
  allowEstimate: boolean;
}

/** Decision 2's chain: a user scale is kept, then printed information, then an estimate. */
export function resolveScale(
  printed: readonly ScaleCandidate[],
  estimates: readonly ScaleCandidate[],
  options: ResolveScaleOptions,
): ScaleResolution {
  const candidates = [...printed, ...estimates];
  const { existing } = options;
  const base = { candidates, issues: [] as SuggestionIssue[] };
  if (existing?.source === 'user')
    return { ...base, status: 'user', scale: existing, suggest: false, confidence: 1 };

  const chosen = (
    status: 'printed' | 'estimate',
    metresPerPixel: number,
    confidence: number,
  ): ScaleResolution => {
    const scale: FloorScale = {
      source: status === 'printed' ? 'dimension_text' : 'ai_estimate',
      metresPerPixel,
    };
    const same =
      existing !== undefined &&
      existing.source === scale.source &&
      Math.abs(existing.metresPerPixel / metresPerPixel - 1) <= SAME_SCALE;
    return { ...base, status, scale, suggest: !same, confidence };
  };

  const independent = collapseEvidence(printed);
  const agreeing = largestAgreement(independent);
  const lone = independent.length === 1;
  if (agreeing.length >= 2 || (lone && LONE_EVIDENCE.has(agreeing[0]!.evidence))) {
    const outliers = independent.length - agreeing.length;
    if (outliers > 0)
      base.issues.push({
        code: 'ai.scale-disagreement',
        severity: 'warning',
        params: { outliers, agreeing: agreeing.length },
      });
    let confidence = agreeing.length >= 2 ? 0.95 : agreeing[0]!.evidence === 'ratio' ? 0.8 : 0.6;
    if (lone && agreeing[0]!.unconfirmed) {
      base.issues.push({ code: 'ai.scale-unconfirmed', severity: 'warning' });
      confidence = 0.5;
    }
    return chosen(
      'printed',
      median(agreeing.map((c) => c.metresPerPixel)),
      outliers > 0 ? confidence - 0.1 : confidence,
    );
  }
  if (independent.length >= 2)
    base.issues.push({
      code: 'ai.scale-disagreement',
      severity: 'warning',
      params: { outliers: independent.length, agreeing: 0 },
    });

  const estimate = options.allowEstimate ? estimateFrom(estimates) : null;
  if (estimate) return chosen('estimate', estimate.metresPerPixel, estimate.confidence);
  if (existing)
    return { ...base, status: 'existing', scale: existing, suggest: false, confidence: 1 };
  return { ...base, status: 'none', scale: null, suggest: false, confidence: 0 };
}
