import type { FloorRecord, Id, Issue } from '@el-karta/core';
import { floorIssues } from '../validation/floor-issues';

/** Validator codes that point at a wall: a wall without length, or items beyond its end. */
export const WALL_ISSUE_CODES = [
  'wall.zero-length',
  'opening.outside-wall',
  'placement.offset-beyond-wall',
] as const;
export type WallIssueCode = (typeof WALL_ISSUE_CODES)[number];

export type WallIssue = Issue & { code: WallIssueCode };

const isWallIssue = (issue: Issue): issue is WallIssue =>
  (WALL_ISSUE_CODES as readonly string[]).includes(issue.code);

function wallOf(issue: WallIssue): Id | undefined {
  switch (issue.code) {
    case 'wall.zero-length':
      return issue.ids[0];
    case 'opening.outside-wall':
      return issue.ids[1];
    case 'placement.offset-beyond-wall': {
      const wallId = issue.params?.['wallId'];
      return typeof wallId === 'string' ? wallId : undefined;
    }
  }
}

const cache = new WeakMap<FloorRecord['data'], ReadonlyMap<Id, readonly WallIssue[]>>();

/** The validator's issues about each wall on the floor, keyed by wall id. Cached per floor data. */
export function wallIssues(floor: FloorRecord): ReadonlyMap<Id, readonly WallIssue[]> {
  const cached = cache.get(floor.data);
  if (cached) return cached;
  const byWall = new Map<Id, WallIssue[]>();
  for (const issue of floorIssues(floor)) {
    if (!isWallIssue(issue)) continue;
    const wallId = wallOf(issue);
    if (wallId === undefined || !(wallId in floor.data.walls)) continue;
    const list = byWall.get(wallId);
    if (list) list.push(issue);
    else byWall.set(wallId, [issue]);
  }
  cache.set(floor.data, byWall);
  return byWall;
}
