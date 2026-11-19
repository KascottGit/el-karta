import { z } from 'zod';
import { FloorData, FloorRecord, ProjectData, ProjectRecord } from '../schemas/index.ts';

export const CURRENT_SCHEMA_VERSION = 1;

type Doc = Record<string, unknown>;
/** Migrates a document from the version it is keyed under to the next one. */
export type MigrationStep = (doc: Doc) => Doc;

export class MigrationError extends Error {
  override name = 'MigrationError';
}

export function createMigrator<T>(options: {
  schema: z.ZodType<T>;
  current: number;
  steps: Readonly<Record<number, MigrationStep>>;
}): (raw: unknown) => T {
  return (raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new MigrationError('Document is not an object');
    }
    let doc = raw as Doc;
    const version = doc['schemaVersion'];
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new MigrationError('Document has no valid schemaVersion');
    }
    if (version > options.current) {
      throw new MigrationError(
        `Document schemaVersion ${version} is newer than supported ${options.current}`,
      );
    }
    for (let v = version; v < options.current; v++) {
      const step = options.steps[v];
      if (!step) throw new MigrationError(`No migration from schemaVersion ${v}`);
      doc = { ...step(doc), schemaVersion: v + 1 };
    }
    return options.schema.parse(doc);
  };
}

const floorSteps: Record<number, MigrationStep> = {};
const projectSteps: Record<number, MigrationStep> = {};

export const migrateFloorData = createMigrator({
  schema: FloorData,
  current: CURRENT_SCHEMA_VERSION,
  steps: floorSteps,
});
export const migrateProjectData = createMigrator({
  schema: ProjectData,
  current: CURRENT_SCHEMA_VERSION,
  steps: projectSteps,
});

const FloorEnvelope = FloorRecord.extend({ data: z.unknown() });
const ProjectEnvelope = ProjectRecord.extend({ data: z.unknown() });

/** Parses a stored floor row (any supported schema version) into a current `FloorRecord`. */
export function parseFloorRecord(raw: unknown): FloorRecord {
  const envelope = FloorEnvelope.parse(raw);
  return { ...envelope, data: migrateFloorData(envelope.data) };
}

export function parseProjectRecord(raw: unknown): ProjectRecord {
  const envelope = ProjectEnvelope.parse(raw);
  return { ...envelope, data: migrateProjectData(envelope.data) };
}
