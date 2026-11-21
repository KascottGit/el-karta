import type { Issue } from '@el-karta/core';
import { NORM } from './frame.ts';
import type { FloorplanOutput, LocateOutput, NormBox, NormPoint } from './schema.ts';

/** Coordinates a little outside 0–1000 are rounding and get clamped; further out is a misreading. */
const SLACK = 10;

const outside = (p: NormPoint) =>
  p.x < -SLACK || p.y < -SLACK || p.x > NORM + SLACK || p.y > NORM + SLACK;

const issue = (
  code: string,
  severity: Issue['severity'],
  params?: Record<string, string | number>,
): Issue => ({ code, severity, ids: [], ...(params ? { params } : {}) });

function boxIssues(box: NormBox, field: string): Issue[] {
  if (outside({ x: box.xmin, y: box.ymin }) || outside({ x: box.xmax, y: box.ymax }))
    return [issue('ai.coordinate-out-of-range', 'error', { field })];
  if (box.xmax <= box.xmin || box.ymax <= box.ymin)
    return [issue('ai.box-invalid', 'error', { field })];
  return [];
}

export function validateLocate(output: LocateOutput): Issue[] {
  if (!output.found) return [];
  if (!output.box) return [issue('ai.box-missing', 'error', { field: 'box' })];
  return boxIssues(output.box, 'box');
}

/** Checks that make the runner retry (errors) or that are shown with the result (warnings). */
export function validateFloorplan(output: FloorplanOutput): Issue[] {
  const issues: Issue[] = [];
  const points: [string, NormPoint][] = [
    ...output.walls.flatMap((w, i): [string, NormPoint][] => [
      [`walls.${i}`, w.a],
      [`walls.${i}`, w.b],
    ]),
    ...output.openings.flatMap((o, i): [string, NormPoint][] => [
      [`openings.${i}`, o.a],
      [`openings.${i}`, o.b],
    ]),
    ...output.rooms.map((r, i): [string, NormPoint] => [`rooms.${i}`, r.point]),
    ...output.dimensions.flatMap((d, i): [string, NormPoint][] => [
      [`dimensions.${i}`, d.a],
      [`dimensions.${i}`, d.b],
    ]),
    ...output.standardObjects.flatMap((s, i): [string, NormPoint][] => [
      [`standardObjects.${i}`, s.a],
      [`standardObjects.${i}`, s.b],
    ]),
    ...(output.scaleBar?.ticks ?? []).map((t, i): [string, NormPoint] => [
      `scaleBar.ticks.${i}`,
      t.point,
    ]),
  ];
  const reported = new Set<string>();
  for (const [field, p] of points) {
    if (outside(p) && !reported.has(field)) {
      reported.add(field);
      issues.push(issue('ai.coordinate-out-of-range', 'error', { field }));
    }
  }
  output.rooms.forEach((r, i) => {
    if (r.box) issues.push(...boxIssues(r.box, `rooms.${i}.box`));
  });
  if (output.walls.length === 0 && output.rooms.length > 0)
    issues.push(issue('ai.no-walls', 'error'));
  output.walls.forEach((w, i) => {
    if (w.a.x === w.b.x && w.a.y === w.b.y)
      issues.push(issue('ai.wall-zero-length', 'warning', { field: `walls.${i}` }));
  });
  output.openings.forEach((o, i) => {
    if (o.a.x === o.b.x && o.a.y === o.b.y)
      issues.push(issue('ai.opening-zero-width', 'warning', { field: `openings.${i}` }));
  });
  output.dimensions.forEach((d, i) => {
    if (!(d.value > 0))
      issues.push(issue('ai.dimension-invalid', 'error', { field: `dimensions.${i}` }));
  });
  return issues;
}
