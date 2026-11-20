import { checkDevices, checkSpace, generateProject } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { WALL_ISSUE_CODES } from '../walls/wall-issues';
import { floorIssues } from './floor-issues';

describe('floor issues', () => {
  it('is the space and device validation of the floor, computed once per floor data', () => {
    const floor = Object.values(generateProject('small').floors)[0]!;
    const issues = floorIssues(floor);
    expect(issues).toEqual([...checkSpace(floor), ...checkDevices(floor)]);
    expect(floorIssues(floor)).toBe(issues);
    expect(floorIssues({ ...floor, version: floor.version + 1 })).toBe(issues);
    expect(floorIssues({ ...floor, data: { ...floor.data } })).not.toBe(issues);
  });

  it('has a Swedish message for wall, room and zone issues in one issues section', () => {
    expect(i18n.t('issues.placement.outside-room', { count: 2 })).toBe(
      '2 takmonterade enheter ligger utanför rummet.',
    );
    expect(i18n.t('issues.room.polygon-self-intersecting')).toBe(
      'Rummets kontur korsar sig själv.',
    );
    for (const code of WALL_ISSUE_CODES) expect(i18n.exists(`issues.${code}`)).toBe(true);
  });
});
