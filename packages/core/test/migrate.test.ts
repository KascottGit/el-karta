import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';
import {
  createMigrator,
  CURRENT_SCHEMA_VERSION,
  generateProject,
  migrateFloorData,
  migrateProjectData,
  MigrationError,
  Model,
  parseFloorRecord,
  parseProjectRecord,
} from '../src/index.ts';
import { ModelBuilder } from './builder.ts';

describe('schemas', () => {
  it('accept generated projects', () => {
    expect(() => Model.parse(generateProject('medium'))).not.toThrow();
  });

  it('reject malformed data with a path to the problem', () => {
    const model = new ModelBuilder().build();
    const floor = Object.values(model.floors)[0]!;
    const key = '00000000-0000-4000-8000-000000000000';
    const bad = {
      ...floor.data,
      walls: {
        [key]: {
          id: 'not-a-uuid',
          a: { x: 0, y: 0 },
          b: { x: 1 },
          thickness: -1,
          provenance: { status: 'guess' },
        },
      },
    };
    const result = migrateFloorData.bind(null, bad);
    expect(result).toThrow(ZodError);
    try {
      result();
    } catch (error) {
      const paths = (error as ZodError).issues.map((i) => i.path.join('.'));
      expect(paths).toEqual(
        ['id', 'b.y', 'thickness', 'provenance.status'].map((field) => `walls.${key}.${field}`),
      );
    }
  });
});

describe('migrations', () => {
  it('parses current documents and stored rows', () => {
    const model = new ModelBuilder().build();
    const floor = Object.values(model.floors)[0]!;
    expect(migrateFloorData(JSON.parse(JSON.stringify(floor.data)))).toEqual(floor.data);
    expect(migrateProjectData(model.project.data)).toEqual(model.project.data);
    expect(parseFloorRecord(JSON.parse(JSON.stringify(floor)))).toEqual(floor);
    expect(parseProjectRecord(model.project)).toEqual(model.project);
  });

  it('rejects documents without a version or from a newer app', () => {
    expect(() => migrateFloorData({})).toThrow(MigrationError);
    expect(() => migrateFloorData([])).toThrow(MigrationError);
    expect(() => migrateFloorData({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(
      'newer than supported',
    );
  });

  it('applies each step in order up to the current version', () => {
    const Schema = z.object({
      schemaVersion: z.literal(3),
      name: z.string(),
      tags: z.array(z.string()),
    });
    const migrate = createMigrator({
      schema: Schema,
      current: 3,
      steps: {
        1: ({ title, ...rest }) => ({ ...rest, name: title }),
        2: (doc) => ({ ...doc, tags: [] }),
      },
    });
    expect(migrate({ schemaVersion: 1, title: 'Villa' })).toEqual({
      schemaVersion: 3,
      name: 'Villa',
      tags: [],
    });
    expect(migrate({ schemaVersion: 2, name: 'Kontor' })).toEqual({
      schemaVersion: 3,
      name: 'Kontor',
      tags: [],
    });
    expect(() =>
      createMigrator({ schema: Schema, current: 3, steps: { 2: (d) => d } })({ schemaVersion: 1 }),
    ).toThrow('No migration from schemaVersion 1');
  });
});
