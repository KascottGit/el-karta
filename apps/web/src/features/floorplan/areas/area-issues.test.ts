import { generateProject, type Pt } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { areaIssues, worstSeverity } from './area-issues';

const pt = (x: number, y: number): Pt => ({ x, y });

/** The first floor of the small synthetic project, with one room broken and one ceiling device moved out of its room. */
function brokenFloor() {
  const model = generateProject('small');
  const floor = structuredClone(Object.values(model.floors).find((f) => f.sortOrder === 0)!);
  const [room, other] = Object.values(floor.data.rooms);
  room!.polygon = [pt(0, 0), pt(2, 2), pt(2, 0), pt(0, 2)];
  const ceilingDevices = Object.values(floor.data.devices).filter(
    (d) => d.placement.kind === 'ceiling' && d.placement.roomId === other!.id,
  );
  const [moved] = ceilingDevices;
  if (moved?.placement.kind === 'ceiling') moved.placement.at = pt(-50, -50);
  return { floor, room: room!, other: other!, moved: moved !== undefined };
}

describe('area issues', () => {
  it('reports a self-intersecting outline on the room as an error', () => {
    const { floor, room } = brokenFloor();
    const issues = areaIssues(floor).get(room.id);
    expect(issues).toContainEqual({
      code: 'room.polygon-self-intersecting',
      severity: 'error',
      message: 'issues.room.polygon-self-intersecting',
      count: 1,
    });
    expect(worstSeverity(issues)).toBe('error');
  });

  it('counts ceiling devices outside their room as a warning on the room', () => {
    const { floor, other, moved } = brokenFloor();
    expect(moved).toBe(true);
    expect(areaIssues(floor).get(other.id)).toEqual([
      {
        code: 'placement.outside-room',
        severity: 'warning',
        message: 'issues.placement.outside-room',
        count: 1,
      },
    ]);
  });

  it('has nothing to say about a valid floor, and caches per floor', () => {
    const floor = Object.values(generateProject('small').floors)[0]!;
    expect(areaIssues(floor).size).toBe(0);
    expect(areaIssues(floor)).toBe(areaIssues(floor));
    expect(worstSeverity(undefined)).toBeNull();
  });
});
