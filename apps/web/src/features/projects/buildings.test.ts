import { createEmptyProject, type Model } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { buildingsInOrder } from './buildings';

function withBuildings(names: string[]): Model {
  let n = 0;
  const model = createEmptyProject({
    id: () => `id-${n++}`,
    name: 'Test',
    kind: 'home',
    buildingName: names[0]!,
    floorName: 'Plan 1',
  });
  const buildings = { ...model.project.data.buildings };
  for (const name of names.slice(1)) {
    const id = `id-${n++}`;
    buildings[id] = { id, name };
  }
  return { ...model, project: { ...model.project, data: { ...model.project.data, buildings } } };
}

describe('buildingsInOrder', () => {
  it('orders buildings by name with the collation of the given locale', () => {
    const model = withBuildings(['Östra', 'Annex', 'Ängen', 'Hus']);
    expect(buildingsInOrder(model, 'sv').map((b) => b.name)).toEqual([
      'Annex',
      'Hus',
      'Ängen',
      'Östra',
    ]);
    expect(buildingsInOrder(model, 'de').map((b) => b.name)).toEqual([
      'Ängen',
      'Annex',
      'Hus',
      'Östra',
    ]);
  });
});
