import {
  OPENING_DEFAULTS,
  type FloorRecord,
  type Id,
  type Pt,
  type Suggestion,
  type SuggestionDraft,
} from '@el-karta/core';
import { boundsOf } from '@/features/floorplan/canvas/rect';
import { modelStore } from '@/model/store';
import { createMemorySource, type MemorySource } from './source';

/** Dev builds: `?suggestions` in the URL reviews these instead of the database's (e2e, `/dev/synthetic`). */
export const DEMO_PARAM = 'suggestions';

const pt = (x: number, y: number): Pt => ({ x, y });

/**
 * A suggested 4 × 3 m bedroom beside the floor's walls, as a floor-plan pass would propose it: a
 * scale and a floor height, four walls and the room requiring the scale, and a door and a window
 * requiring their walls. Confidences and issues vary so every way of showing them is exercised.
 */
export function demoDrafts(floor: FloorRecord, id: () => Id = () => crypto.randomUUID()) {
  const ends = Object.values(floor.data.walls).flatMap((w) => [w.a, w.b]);
  const bounds = boundsOf(ends);
  const x = (bounds?.maxX ?? 0) + 2;
  const y = bounds?.minY ?? 0;
  const corners = [pt(x, y), pt(x + 4, y), pt(x + 4, y + 3), pt(x, y + 3)];
  const scaleId = id();
  const drafts: SuggestionDraft[] = [
    {
      id: scaleId,
      kind: 'scale',
      payload: { source: 'dimension_text', metresPerPixel: 0.012 },
      confidence: 0.9,
      issues: [],
      requires: [],
    },
    {
      id: id(),
      kind: 'floor-height',
      payload: { height: 2.55 },
      confidence: 0.9,
      issues: [],
      requires: [],
    },
  ];
  const confidences = [0.9, 0.85, 0.7, 0.5];
  const walls = corners.map((a, i) => {
    const wall = { id: id(), a, b: corners[(i + 1) % 4]!, thickness: 0.15 };
    const suggestion = id();
    drafts.push({
      id: suggestion,
      kind: 'wall',
      payload: wall,
      confidence: confidences[i]!,
      issues: [],
      requires: [scaleId],
    });
    return { suggestion, wall };
  });
  const [top, , bottom] = walls;
  drafts.push(
    {
      id: id(),
      kind: 'opening',
      payload: {
        id: id(),
        wallId: bottom!.wall.id,
        kind: 'door',
        offset: 1.5,
        ...OPENING_DEFAULTS.door,
      },
      confidence: 0.8,
      issues: [],
      requires: [bottom!.suggestion],
    },
    {
      id: id(),
      kind: 'opening',
      payload: {
        id: id(),
        wallId: top!.wall.id,
        kind: 'window',
        offset: 1.4,
        ...OPENING_DEFAULTS.window,
      },
      confidence: 0.6,
      issues: [],
      requires: [top!.suggestion],
    },
    {
      id: id(),
      kind: 'room',
      payload: { id: id(), name: 'Sovrum', type: 'bedroom', polygon: corners },
      confidence: 0.85,
      issues: [
        {
          code: 'ai.room-area-mismatch',
          severity: 'warning',
          params: { printed: 11, computed: 12 },
        },
      ],
      requires: [scaleId],
    },
  );
  return drafts;
}

export const demoSuggestions = (floor: FloorRecord, projectId: Id): Suggestion[] =>
  demoDrafts(floor).map((d) => ({
    ...d,
    projectId,
    floorId: floor.id,
    runId: null,
    pass: 'floorplan',
    source: 'ai:floorplan:demo',
    status: 'pending',
  }));

export function demoSource(): MemorySource {
  return createMemorySource({
    id: 'demo',
    seed: (floorId) => {
      const { model } = modelStore.getState();
      const floor = model?.floors[floorId];
      return floor ? demoSuggestions(floor, floor.projectId) : [];
    },
  });
}
