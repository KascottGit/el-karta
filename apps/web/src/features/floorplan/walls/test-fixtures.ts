import { createEmptyProject, type Model, type Pt, type Wall } from '@el-karta/core';
import type { CanvasContext, CanvasPointer } from '../canvas/extension';

export const pt = (x: number, y: number): Pt => ({ x, y });

export const wall = (a: Pt, b: Pt, thickness = 0.2, id: string = crypto.randomUUID()): Wall => ({
  id,
  a,
  b,
  thickness,
  provenance: { status: 'manual' },
});

/** A project with two empty floors, the first holding `walls`. */
export function projectWith(walls: readonly Wall[] = []) {
  const model: Model = createEmptyProject({
    id: () => crypto.randomUUID(),
    name: 'Test',
    kind: 'home',
    buildingName: 'Hus',
    floorName: 'Plan 1',
  });
  const first = Object.values(model.floors)[0]!;
  const second = {
    ...first,
    id: crypto.randomUUID(),
    name: 'Plan 2',
    sortOrder: 1,
    data: { ...first.data, walls: {} },
  };
  first.data.walls = Object.fromEntries(walls.map((w) => [w.id, w]));
  model.floors[second.id] = second;
  return { model, floorId: first.id, otherFloorId: second.id };
}

/** 100 pixels per metre, so the mouse snap reach of 10 px is 0.1 m. */
export const testCtx = (floorId: string): CanvasContext => ({
  floorId,
  itemAt: () => null,
  pxToWorld: (px) => px / 100,
  zoomToFit: () => {},
});

export const pointer = (world: Pt, extra: Partial<CanvasPointer> = {}): CanvasPointer => ({
  world,
  screen: { x: world.x * 100, y: world.y * 100 },
  kind: 'mouse',
  shiftKey: false,
  altKey: false,
  modKey: false,
  onHandle: false,
  ...extra,
});
