import { checkSpace, type FloorRecord, type Id, type Issue } from '@el-karta/core';

/** Validator codes about openings. */
export const OPENING_ISSUE_CODES = [
  'opening.outside-wall',
  'opening.overlap',
  'opening.wall-missing',
] as const;
export type OpeningIssueCode = (typeof OPENING_ISSUE_CODES)[number];

export type OpeningIssue = Issue & { code: OpeningIssueCode };

const isOpeningIssue = (issue: Issue): issue is OpeningIssue =>
  (OPENING_ISSUE_CODES as readonly string[]).includes(issue.code);

/** The openings an issue is about: both openings of an overlap, otherwise the first id. */
const openingsOf = (issue: OpeningIssue): readonly (Id | undefined)[] =>
  issue.code === 'opening.overlap' ? issue.ids : [issue.ids[0]];

const cache = new WeakMap<FloorRecord['data'], ReadonlyMap<Id, readonly OpeningIssue[]>>();

/** The validator's issues about each opening on the floor, keyed by opening id. Cached per floor data. */
export function openingIssues(floor: FloorRecord): ReadonlyMap<Id, readonly OpeningIssue[]> {
  const cached = cache.get(floor.data);
  if (cached) return cached;
  const byOpening = new Map<Id, OpeningIssue[]>();
  for (const issue of checkSpace(floor)) {
    if (!isOpeningIssue(issue)) continue;
    for (const id of openingsOf(issue)) {
      if (id === undefined || !(id in floor.data.openings)) continue;
      const list = byOpening.get(id);
      if (list) list.push(issue);
      else byOpening.set(id, [issue]);
    }
  }
  cache.set(floor.data, byOpening);
  return byOpening;
}
