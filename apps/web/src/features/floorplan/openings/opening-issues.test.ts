import { generateProject, type Opening } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { projectWith, pt, wall } from '../walls/test-fixtures';
import { openingIssues, OPENING_ISSUE_CODES } from './opening-issues';

const opening = (id: string, offset: number, wallId = 'w'): Opening => ({
  id,
  wallId,
  kind: 'window',
  offset,
  width: 1.2,
  height: 1.2,
  provenance: { status: 'manual' },
});

describe('opening issues', () => {
  it('flag an opening beyond the wall end, both openings of an overlap, and a missing wall', () => {
    const { model, floorId } = projectWith([wall(pt(0, 0), pt(4, 0), 0.2, 'w')]);
    const floor = model.floors[floorId]!;
    floor.data.openings = {
      a: opening('a', 0.5),
      b: opening('b', 1),
      c: opening('c', 3.5),
      d: opening('d', 0, 'gone'),
      e: opening('e', 2.2),
    };
    const issues = openingIssues(floor);
    const codes = (id: string) => issues.get(id)?.map((i) => i.code);
    expect(codes('a')).toEqual(['opening.overlap']);
    expect(codes('b')).toEqual(['opening.overlap']);
    expect(codes('c')).toEqual(['opening.outside-wall']);
    expect(codes('d')).toEqual(['opening.wall-missing']);
    expect(codes('e')).toBeUndefined();
    expect(openingIssues(floor)).toBe(issues);
  });

  it('finds none on the generated projects', () => {
    for (const floor of Object.values(generateProject('small').floors))
      expect(openingIssues(floor).size).toBe(0);
  });

  it('has a Swedish message for every opening issue', () => {
    for (const code of OPENING_ISSUE_CODES) expect(i18n.exists(`issues.${code}`)).toBe(true);
  });
});
