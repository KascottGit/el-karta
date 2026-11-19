import { addDevice, applyEdit, putSpaceItem, type Device, type Opening } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { putWalls, setLength } from './corner';
import { projectWith, pt, wall } from './test-fixtures';
import { wallIssues } from './wall-issues';

const long = wall(pt(0, 0), pt(6, 0), 0.2, 'long');
const plain = wall(pt(0, 2), pt(6, 2), 0.2, 'plain');

const opening: Opening = {
  id: 'door',
  wallId: 'long',
  kind: 'door',
  offset: 4,
  width: 0.9,
  height: 2.1,
  provenance: { status: 'manual' },
};

const outlet: Device = {
  id: 'outlet',
  domain: 'power',
  type: 'outlet',
  label: 'Uttag',
  placement: { kind: 'wall', wallId: 'long', offset: 5.5, height: 0.3, side: 'left' },
  props: {},
  ports: [],
  provenance: { status: 'manual' },
};

describe('wall issues', () => {
  it('flag openings and devices beyond the end of a shortened wall, keyed by wall', () => {
    const { model, floorId } = projectWith([long, plain]);
    let next = applyEdit(model, putSpaceItem(floorId, 'openings', opening)).model;
    next = applyEdit(next, addDevice(floorId, outlet)).model;
    expect(wallIssues(next.floors[floorId]!).size).toBe(0);

    const shorter = setLength(next.floors[floorId]!.data.walls, 'long', 3)!;
    next = applyEdit(next, putWalls(floorId, shorter)).model;
    const issues = wallIssues(next.floors[floorId]!);
    expect([...issues.keys()]).toEqual(['long']);
    expect(issues.get('long')?.map((i) => [i.code, i.severity])).toEqual([
      ['opening.outside-wall', 'error'],
      ['placement.offset-beyond-wall', 'warning'],
    ]);
  });

  it('are cached per floor data', () => {
    const { model, floorId } = projectWith([long]);
    const floor = model.floors[floorId]!;
    expect(wallIssues(floor)).toBe(wallIssues(floor));
  });
});
