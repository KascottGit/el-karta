import { generateProject, type Model } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { buildingFloors, createView3dStore, visibleFloors } from './floor-visibility';

const names = (floors: { name: string }[]) => floors.map((f) => f.name);

function withSecondBuilding(model: Model): Model {
  const floor = Object.values(model.floors)[0]!;
  return {
    ...model,
    floors: {
      ...model.floors,
      other: { ...floor, id: 'other', buildingId: 'b2', name: 'Annat hus' },
    },
  };
}

describe('visibleFloors', () => {
  const model = withSecondBuilding(generateProject('medium', 3));
  const floors = buildingFloors(model, Object.keys(model.floors)[0]!);
  const [first, second, third] = floors;

  it('lists the floors of the current floor’s building, bottom first', () => {
    expect(floors).toHaveLength(5);
    expect(floors.map((f) => f.data.elevation)).toEqual(
      [...floors.map((f) => f.data.elevation)].sort((a, b) => a - b),
    );
    expect(names(floors)).not.toContain('Annat hus');
  });

  it('shows the current floor, all floors of its building, or the chosen ones', () => {
    expect(visibleFloors(model, second!.id, { kind: 'current' })).toEqual([second]);
    expect(visibleFloors(model, second!.id, { kind: 'all' })).toEqual(floors);
    expect(
      visibleFloors(model, first!.id, { kind: 'some', ids: [third!.id, first!.id, 'other'] }),
    ).toEqual([first, third]);
  });

  it('falls back to the current floor when the choice leaves none', () => {
    expect(visibleFloors(model, second!.id, { kind: 'some', ids: [] })).toEqual([second]);
    expect(visibleFloors(model, 'other', { kind: 'some', ids: [first!.id] })).toEqual([
      model.floors['other'],
    ]);
  });
});

describe('view3dStore', () => {
  it('keeps the floor choice and exploded toggle, and counts fit requests', () => {
    const store = createView3dStore();
    store.getState().setFloors({ kind: 'all' });
    store.getState().setExploded(true);
    store.getState().requestFit();
    store.getState().requestFit();
    expect(store.getState()).toMatchObject({
      floors: { kind: 'all' },
      exploded: true,
      fitRequest: 2,
    });
  });
});
