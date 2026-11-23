import { applyEdit, generateProject, putSpaceItem, type Model } from '@el-karta/core';
import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { issueColors } from '@/features/floorplan/canvas/theme';
import { buildCounts, floorMeshes } from './floor-meshes';
import { highlightGeometry } from './highlight';

const buildsOf = (model: Model) => {
  const counts = buildCounts();
  return Object.keys(model.floors).map((id) => counts[id] ?? 0);
};

describe('floorMeshes', () => {
  it('builds each floor once, and after an edit rebuilds only the edited floor', () => {
    const model = generateProject('medium', 11);
    const floors = Object.values(model.floors);
    for (const floor of floors) floorMeshes(floor);
    for (const floor of floors) floorMeshes(floor);
    const before = buildsOf(model);
    expect(before.every((n) => n === 1)).toBe(true);

    const edited = floors[2]!;
    const wall = Object.values(edited.data.walls)[0]!;
    const next = applyEdit(
      model,
      putSpaceItem(edited.id, 'walls', { ...wall, height: (wall.height ?? 2.5) + 0.5 }),
    ).model;
    for (const floor of Object.values(next.floors)) floorMeshes(floor);
    expect(buildsOf(next)).toEqual(before.map((n, i) => (i === 2 ? n + 1 : n)));
  });

  it('is not rebuilt by highlighting a selection', () => {
    const model = generateProject('small', 12);
    const floor = Object.values(model.floors)[0]!;
    const meshes = floorMeshes(floor);
    const built = buildCounts()[floor.id];
    const wallId = Object.keys(floor.data.walls)[0]!;
    const roomId = Object.keys(floor.data.rooms)[0]!;
    const deviceId = meshes.devices[0]!.ids[0]!;
    const openingId = Object.keys(floor.data.openings)[0]!;
    const highlight = highlightGeometry(meshes, [
      { collection: 'walls', id: wallId },
      { collection: 'openings', id: openingId },
      { collection: 'rooms', id: roomId },
      { collection: 'devices', id: deviceId },
    ]);
    expect(highlight?.items).toHaveLength(4);
    expect(floorMeshes(floor)).toBe(meshes);
    expect(buildCounts()[floor.id]).toBe(built);
  });

  it('colours a device by its worst issue, like the 2D layer', () => {
    const model = generateProject('small', 13);
    const floor = Object.values(model.floors)[0]!;
    const device = Object.values(floor.data.devices).find((d) => d.placement.kind === 'wall')!;
    const broken = applyEdit(model, (draft) => {
      const d = draft.floors[floor.id]!.data.devices[device.id]!;
      if (d.placement.kind === 'wall') d.placement.offset = 1000;
    }).model;
    const meshes = floorMeshes(broken.floors[floor.id]!);
    const group = meshes.devices.find((g) => g.ids.includes(device.id))!;
    const i = group.ids.indexOf(device.id);
    const expected = new Color(issueColors.warning).toArray();
    const actual = [...group.colors.slice(i * 3, i * 3 + 3)];
    actual.forEach((v, k) => {
      expect(v).toBeCloseTo(expected[k]!, 5);
    });
  });
});
