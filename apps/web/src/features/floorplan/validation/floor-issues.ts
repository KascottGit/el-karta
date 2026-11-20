import { checkDevices, checkSpace, type FloorRecord, type Issue } from '@el-karta/core';

const cache = new WeakMap<FloorRecord['data'], readonly Issue[]>();

/**
 * The validator's issues about one floor's walls, openings, rooms, zones and devices. Cached per
 * floor data, so every feature that shows issues shares one validation per edit.
 */
export function floorIssues(floor: FloorRecord): readonly Issue[] {
  let issues = cache.get(floor.data);
  if (!issues) {
    issues = [...checkSpace(floor), ...checkDevices(floor)];
    cache.set(floor.data, issues);
  }
  return issues;
}
