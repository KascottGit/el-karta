import { describe, expect, it } from 'vitest';
import {
  createEmptyProject,
  Model,
  seededRandom,
  seededUuid,
  validateModel,
} from '../src/index.ts';

describe('createEmptyProject', () => {
  it('creates a valid project with one building and one floor at the default height for its kind', () => {
    const model = createEmptyProject({
      id: seededUuid(seededRandom(1)),
      name: 'Lagret',
      kind: 'warehouse',
      buildingName: 'Byggnad 1',
      floorName: 'Plan 1',
    });
    expect(() => Model.parse(model)).not.toThrow();
    expect(validateModel(model)).toEqual([]);
    const [floor] = Object.values(model.floors);
    expect(floor).toMatchObject({
      name: 'Plan 1',
      sortOrder: 0,
      data: { height: 8, elevation: 0 },
    });
    expect(model.project.data.buildings[floor!.buildingId]?.name).toBe('Byggnad 1');
  });
});
