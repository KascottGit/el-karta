import type {
  BackgroundPlacement,
  FloorScale,
  Id,
  Opening,
  Room,
  SuggestionIssue,
  Wall,
} from '@el-karta/core';
import type { SuggestionDraft } from '@el-karta/core';
import type { Tile } from '../pass.ts';
import { clampNorm, mapFloorplan, outputToPixels } from './frame.ts';
import { planGeometry } from './geometry.ts';
import {
  areaCandidates,
  estimateCandidates,
  printedCandidates,
  resolveScale,
  type ScaleResolution,
} from './scale.ts';
import type { FloorplanOutput } from './schema.ts';

export interface FloorplanSuggestOptions {
  /**
   * The rectangle of the full background image, in its pixels, that the output's 0–1000
   * coordinates span: the sent image's frame for one call, `tilesBounds` of the tiles after `merge`.
   */
  frame: Tile;
  /** The full background image in pixels. */
  imageSize: { width: number; height: number };
  /** The floor's background placement; its `metresPerPixel` is used only when no scale is found. */
  placement: BackgroundPlacement;
  /** The floor's current scale; a user scale is always kept. */
  existingScale?: FloorScale | undefined;
  /** The floor's current height, so an equal printed ceiling height is not suggested again. */
  floorHeight?: number | undefined;
  /** Width of the PDF page in millimetres, when the background is a rendered PDF page. */
  pdfPageWidthMm?: number | undefined;
  /** Whether a scale may be estimated from objects of standard size when nothing printed gives one. */
  allowEstimate: boolean;
}

/** A single door narrower or wider than this, in metres, suggests the scale is wrong (decision 2). */
export const DOOR_WIDTH = { min: 0.6, max: 1.2 } as const;

/** Printed ceiling heights outside this range in metres are misreadings. */
const CEILING_HEIGHT = { min: 1.8, max: 6 } as const;

/** A filled room whose area differs from its printed area by more than this fraction is flagged. */
const ROOM_AREA_MISMATCH = 0.15;

export interface FloorplanInterpretation {
  drafts: SuggestionDraft[];
  scale: ScaleResolution;
  /** About the reading as a whole, such as openings that fit no wall; also on the scale draft. */
  issues: SuggestionIssue[];
}

/** Walls and rooms measured at a placeholder scale are guesses, whatever the geometry looks like. */
const UNKNOWN_SCALE_CONFIDENCE = 0.3;

function chooseScale(px: FloorplanOutput, options: FloorplanSuggestOptions) {
  const printed = printedCandidates(px, options);
  const estimates = estimateCandidates(px);
  const scaleOptions = { existing: options.existingScale, allowEstimate: options.allowEstimate };
  let resolution = resolveScale(printed, estimates, scaleOptions);
  let mpp = resolution.scale?.metresPerPixel ?? options.placement.metresPerPixel;
  let geometry = planGeometry(px, { ...options.placement, metresPerPixel: mpp });
  // Area evidence needs room polygons, which need a scale for the cleanup tolerances; a second
  // round settles it when the areas moved the scale.
  for (let round = 0; round < 2; round++) {
    const samples = geometry.rooms.map((room) => ({
      printedArea: room.printedArea,
      outdoor: room.outdoor,
      pixelArea: room.netArea === null ? null : room.netArea / (mpp * mpp),
    }));
    const areas = areaCandidates(samples, px.totalArea);
    if (areas.length === 0) break;
    resolution = resolveScale([...printed, ...areas], estimates, scaleOptions);
    const next = resolution.scale?.metresPerPixel ?? options.placement.metresPerPixel;
    if (Math.abs(next / mpp - 1) < 1e-6) break;
    mpp = next;
    geometry = planGeometry(px, { ...options.placement, metresPerPixel: mpp });
  }
  return { resolution, geometry };
}

/**
 * Turns one output (or a merged one) into suggestion drafts with decision 1's geometry and decision
 * 2's scale chain. Walls and rooms are measured at the chosen scale, so they require its suggestion;
 * openings require their wall's.
 */
export function interpretFloorplan(
  output: FloorplanOutput,
  options: FloorplanSuggestOptions,
  newId: () => Id,
): FloorplanInterpretation {
  const px = outputToPixels(
    mapFloorplan(output, clampNorm, (t) => t),
    options.frame,
  );
  const { resolution, geometry } = chooseScale(px, options);
  const drafts: SuggestionDraft[] = [];

  const doorIssue = (width: number): SuggestionIssue => ({
    code: 'scale.door-width-implausible',
    severity: 'warning',
    params: { width: Math.round(width * 100) / 100 },
  });
  const singleDoors = geometry.openings.filter((o) => o.kind === 'door' && !o.double);
  const implausible = (width: number) => width < DOOR_WIDTH.min || width > DOOR_WIDTH.max;

  const overall: SuggestionIssue[] = [];
  if (geometry.unplacedOpenings > 0)
    overall.push({
      code: 'ai.opening-unplaced',
      severity: 'warning',
      params: { count: geometry.unplacedOpenings },
    });
  const unknownScale = resolution.status === 'none';
  const measured = (confidence: number, issues: SuggestionIssue[]) =>
    unknownScale
      ? {
          confidence: Math.min(confidence, UNKNOWN_SCALE_CONFIDENCE),
          issues: [...issues, { code: 'ai.scale-unknown', severity: 'warning' as const }],
        }
      : { confidence, issues };

  let scaleRequires: Id[] = [];
  if (resolution.suggest && resolution.scale) {
    const id = newId();
    const issues = [...resolution.issues, ...overall];
    const wrongDoors = singleDoors.filter((o) => implausible(o.width));
    if (wrongDoors.length * 2 > singleDoors.length) {
      const widths = singleDoors.map((o) => o.width).sort((a, b) => a - b);
      issues.push(doorIssue(widths[Math.floor(widths.length / 2)]!));
    }
    drafts.push({
      id,
      kind: 'scale',
      payload: resolution.scale,
      confidence: resolution.confidence,
      issues,
      requires: [],
    });
    scaleRequires = [id];
  }

  for (const [key, planned] of Object.entries(geometry.walls)) {
    const wall: Omit<Wall, 'provenance'> = {
      id: newId(),
      a: planned.a,
      b: planned.b,
      thickness: planned.thickness,
    };
    const wallSuggestion = newId();
    const ends = Number(planned.joined.a) + Number(planned.joined.b);
    drafts.push({
      id: wallSuggestion,
      kind: 'wall',
      payload: wall,
      ...measured(ends === 2 ? 0.85 : ends === 1 ? 0.7 : 0.5, []),
      requires: scaleRequires,
    });
    for (const o of geometry.openings.filter((o) => o.wallId === key)) {
      const { double, distance, clamped, ...rest } = o;
      const payload: Omit<Opening, 'provenance'> = { ...rest, id: newId(), wallId: wall.id };
      const issues =
        o.kind === 'door' && !double && implausible(o.width) ? [doorIssue(o.width)] : [];
      const onWall = distance <= wall.thickness / 2 + 0.1 && clamped <= 0.1;
      drafts.push({
        id: newId(),
        kind: 'opening',
        payload,
        confidence: issues.length > 0 ? 0.5 : onWall ? 0.8 : 0.6,
        issues,
        requires: [wallSuggestion],
      });
    }
  }

  for (const room of geometry.rooms) {
    const [first] = room.labels;
    if (!first) continue;
    const issues: SuggestionIssue[] = [];
    if (!room.filled) issues.push({ code: 'ai.room-open', severity: 'warning' });
    if (room.labels.length > 1)
      issues.push({
        code: 'ai.room-merged',
        severity: 'warning',
        params: { count: room.labels.length },
      });
    const printed = room.printedArea;
    if (printed !== null && room.netArea !== null && printed > 0) {
      const ratio = room.netArea / printed;
      if (Math.abs(ratio - 1) > ROOM_AREA_MISMATCH)
        issues.push({
          code: 'ai.room-area-mismatch',
          severity: 'warning',
          params: { printed, computed: Math.round(room.netArea * 10) / 10 },
        });
    }
    const payload: Omit<Room, 'provenance'> = {
      id: newId(),
      name: room.labels.map((l) => l.name.trim()).join(' / '),
      type: first.type,
      polygon: room.polygon,
    };
    drafts.push({
      id: newId(),
      kind: 'room',
      payload,
      ...measured(!room.filled ? 0.3 : room.labels.length > 1 ? 0.6 : 0.85, issues),
      requires: scaleRequires,
    });
  }

  const ceiling = px.ceilingHeight;
  if (
    ceiling !== null &&
    ceiling >= CEILING_HEIGHT.min &&
    ceiling <= CEILING_HEIGHT.max &&
    (options.floorHeight === undefined || Math.abs(options.floorHeight - ceiling) > 0.005)
  )
    drafts.push({
      id: newId(),
      kind: 'floor-height',
      payload: { height: ceiling },
      confidence: 0.9,
      issues: [],
      requires: [],
    });

  return { drafts, scale: resolution, issues: overall };
}
