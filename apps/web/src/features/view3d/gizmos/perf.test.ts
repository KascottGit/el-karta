import { generateProject, type FloorRecord } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { fastest } from '../fastest';
import { floorMeshes } from '../meshes/floor-meshes';
import { highlightGeometry } from '../meshes/highlight';
import { previewFloor, startGizmoDrag, type DragAmount, type GizmoDrag } from './drag';
import type { GizmoTarget } from './handles';

const FRAME_MS = 16;
// The full suite runs test files in parallel, so timings share the CPU. The frame budget is
// asserted with PERF_BUDGET=1, as in core's perf test; otherwise a loose bound catches regressions.
const slack = process.env['PERF_BUDGET'] === '1' ? 1 : 4;

const busiest = (): FloorRecord =>
  Object.values(generateProject('large').floors).sort(
    (a, b) => Object.keys(b.data.walls).length - Object.keys(a.data.walls).length,
  )[0]!;

/** One pointer move of a gizmo drag: the change, the preview data, its meshes and the highlight. */
function perMove(floor: FloorRecord, target: GizmoTarget, drag: GizmoDrag) {
  let step = 0;
  return fastest(
    20,
    (): DragAmount => ({ kind: 'axis', along: 0.01 * ++step }),
    (amount) => {
      const change = drag.change(floor.data, amount, { snap: 0.05, round: true });
      if (!change) throw new Error('refused');
      const meshes = floorMeshes({ ...floor, data: previewFloor(floor.data, change) });
      highlightGeometry(meshes, [target])?.geometry.dispose();
    },
  );
}

describe('gizmo preview performance', () => {
  // Measured alone at about 7 ms for a wall move and 7 ms for an opening's top on the busiest floor
  // (110 walls, 811 devices); in the parallel full suite about 16 and 13 ms.
  it('rebuilds the dragged floor of the large synthetic project within a frame per move', () => {
    const floor = busiest();
    floorMeshes(floor);
    const wall = Object.values(floor.data.walls).find(
      (w) => startGizmoDrag(floor.data, { collection: 'walls', id: w.id }, 'move-left') !== null,
    )!;
    const wallTarget = { collection: 'walls', id: wall.id } as const;
    const moveWall = perMove(
      floor,
      wallTarget,
      startGizmoDrag(floor.data, wallTarget, 'move-left')!,
    );
    const opening = Object.values(floor.data.openings)[0]!;
    const openingTarget = { collection: 'openings', id: opening.id } as const;
    const resize = perMove(floor, openingTarget, startGizmoDrag(floor.data, openingTarget, 'top')!);
    expect(moveWall).toBeLessThan(FRAME_MS * slack);
    expect(resize).toBeLessThan(FRAME_MS * slack);
  });
});
