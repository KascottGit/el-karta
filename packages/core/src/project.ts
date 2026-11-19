import { CURRENT_SCHEMA_VERSION } from './migrations/index.ts';
import type { FloorData, Id, Model, ProjectKind } from './schemas/index.ts';

/** Default ceiling height per kind of building, in metres. */
export const DEFAULT_FLOOR_HEIGHT: Readonly<Record<ProjectKind, number>> = {
  home: 2.4,
  office: 3,
  warehouse: 8,
  other: 2.7,
};

export function emptyFloorData(height: number, elevation = 0): FloorData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    elevation,
    height,
    walls: {},
    openings: {},
    rooms: {},
    zones: {},
    devices: {},
    connections: {},
  };
}

/** A new project with one building and one empty floor. Names are user-facing, so the caller supplies them. */
export function createEmptyProject(input: {
  id: () => Id;
  name: string;
  kind: ProjectKind;
  buildingName: string;
  floorName: string;
}): Model {
  const projectId = input.id();
  const buildingId = input.id();
  const floorId = input.id();
  return {
    project: {
      id: projectId,
      name: input.name,
      kind: input.kind,
      version: 1,
      data: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        buildings: { [buildingId]: { id: buildingId, name: input.buildingName } },
        crossFloorConnections: {},
      },
    },
    floors: {
      [floorId]: {
        id: floorId,
        projectId,
        buildingId,
        name: input.floorName,
        sortOrder: 0,
        version: 1,
        data: emptyFloorData(DEFAULT_FLOOR_HEIGHT[input.kind]),
      },
    },
  };
}
