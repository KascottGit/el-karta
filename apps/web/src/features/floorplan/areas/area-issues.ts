import {
  checkDevices,
  checkSpace,
  type FloorRecord,
  type Id,
  type Issue,
  type IssueSeverity,
} from '@el-karta/core';
import type { MessageKey } from '../canvas/extension';

const POLYGON_CODES = [
  'polygon-too-few-points',
  'polygon-repeated-point',
  'polygon-zero-area',
  'polygon-self-intersecting',
] as const;

/** The validator codes shown on rooms and zones, with their messages. */
const MESSAGES: ReadonlyMap<string, MessageKey> = new Map<string, MessageKey>([
  ...POLYGON_CODES.map((c) => [`room.${c}`, `issues.room.${c}`] as const),
  ...POLYGON_CODES.map((c) => [`zone.${c}`, `issues.zone.${c}`] as const),
  ['placement.outside-room', 'issues.placement.outside-room'],
]);

/** Issues of one code on one room or zone, e.g. every ceiling device outside it. */
export interface AreaIssue {
  code: string;
  severity: IssueSeverity;
  message: MessageKey;
  count: number;
}

const NONE: ReadonlyMap<Id, readonly AreaIssue[]> = new Map();
const cache = new WeakMap<FloorRecord, ReadonlyMap<Id, readonly AreaIssue[]>>();

/** The validator's issues about each room and zone on the floor, grouped by code. */
export function areaIssues(floor: FloorRecord): ReadonlyMap<Id, readonly AreaIssue[]> {
  let byArea = cache.get(floor);
  if (byArea) return byArea;
  const { rooms, zones } = floor.data;
  const grouped = new Map<Id, Map<string, AreaIssue>>();
  const add = (areaId: Id, issue: Issue, message: MessageKey) => {
    let codes = grouped.get(areaId);
    if (!codes) grouped.set(areaId, (codes = new Map<string, AreaIssue>()));
    const existing = codes.get(issue.code);
    if (existing) existing.count++;
    else codes.set(issue.code, { code: issue.code, severity: issue.severity, message, count: 1 });
  };
  for (const issue of [...checkSpace(floor), ...checkDevices(floor)]) {
    const message = MESSAGES.get(issue.code);
    if (!message) continue;
    for (const id of issue.ids) if (id in rooms || id in zones) add(id, issue, message);
  }
  byArea =
    grouped.size === 0
      ? NONE
      : new Map([...grouped].map(([id, codes]) => [id, [...codes.values()]]));
  cache.set(floor, byArea);
  return byArea;
}

/** The most severe issue level on an area, for colouring its outline. */
export function worstSeverity(issues: readonly AreaIssue[] | undefined): IssueSeverity | null {
  if (!issues?.length) return null;
  return issues.some((i) => i.severity === 'error') ? 'error' : 'warning';
}
