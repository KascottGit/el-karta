import { checkDevices, checkSpace, generateProject } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
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
});
