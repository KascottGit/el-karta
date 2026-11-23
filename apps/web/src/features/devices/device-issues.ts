import type { Device, FloorRecord, Id, Issue } from '@el-karta/core';
import { issueColors } from '@/features/floorplan/canvas/theme';
import { floorIssues } from '@/features/floorplan/validation/floor-issues';
import { worstSeverity } from '@/features/floorplan/validation/severity';
import { deviceAppearance } from './appearance';

/** Validator codes about a device: its placement and the room and zone it refers to. */
export const DEVICE_ISSUE_CODES = [
  'device.room-missing',
  'device.zone-missing',
  'placement.wall-missing',
  'placement.offset-beyond-wall',
  'placement.room-missing',
  'placement.parent-missing',
  'placement.container-cycle',
  'placement.outside-room',
  'placement.slot-taken',
] as const;
export type DeviceIssueCode = (typeof DEVICE_ISSUE_CODES)[number];

export type DeviceIssue = Issue & { code: DeviceIssueCode };

const isDeviceIssue = (issue: Issue): issue is DeviceIssue =>
  (DEVICE_ISSUE_CODES as readonly string[]).includes(issue.code);

/** Both devices of a taken slot; otherwise the first id (the others are the wall, room or zone). */
const devicesOf = (issue: DeviceIssue): readonly (Id | undefined)[] =>
  issue.code === 'placement.slot-taken' ? issue.ids : [issue.ids[0]];

const cache = new WeakMap<FloorRecord['data'], ReadonlyMap<Id, readonly DeviceIssue[]>>();

/** The validator's issues about each device on the floor, keyed by device id. Cached per floor data. */
export function deviceIssues(floor: FloorRecord): ReadonlyMap<Id, readonly DeviceIssue[]> {
  const cached = cache.get(floor.data);
  if (cached) return cached;
  const byDevice = new Map<Id, DeviceIssue[]>();
  for (const issue of floorIssues(floor)) {
    if (!isDeviceIssue(issue)) continue;
    for (const id of devicesOf(issue)) {
      if (id === undefined || !(id in floor.data.devices)) continue;
      const list = byDevice.get(id);
      if (list) list.push(issue);
      else byDevice.set(id, [issue]);
    }
  }
  cache.set(floor.data, byDevice);
  return byDevice;
}

/** A device's colour on the plan: its worst issue's, or its appearance's. */
export const deviceColor = (
  issues: ReadonlyMap<Id, readonly DeviceIssue[]>,
  device: Pick<Device, 'id' | 'domain' | 'type'>,
): string => {
  const severity = worstSeverity(issues.get(device.id));
  return severity ? issueColors[severity] : deviceAppearance(device).color;
};
