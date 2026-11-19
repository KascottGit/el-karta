import { CURRENT_SCHEMA_VERSION } from './migrations/index.ts';
import type { Building, FloorData, FloorRecord, Id, Model, ProjectKind } from './schemas/index.ts';

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

/** Buildings have no stored order, so they are listed by name. */
export const buildingsInOrder = (model: Model): Building[] =>
  Object.values(model.project.data.buildings).sort(
    (a, b) => a.name.localeCompare(b.name, 'sv') || a.id.localeCompare(b.id),
  );

/** A building's floors from the bottom up. */
export const floorsInOrder = (model: Model, buildingId: Id): FloorRecord[] =>
  Object.values(model.floors)
    .filter((floor) => floor.buildingId === buildingId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

/**
 * A new empty floor on top of its building. It starts where the floor below ends
 * (elevation plus height) and gets the default ceiling height for the project's kind.
 */
export function newFloor(
  model: Model,
  input: { id: Id; buildingId: Id; name: string },
): FloorRecord {
  const below = floorsInOrder(model, input.buildingId).at(-1);
  return {
    id: input.id,
    projectId: model.project.id,
    buildingId: input.buildingId,
    name: input.name,
    sortOrder: below ? below.sortOrder + 1 : 0,
    version: 1,
    data: emptyFloorData(
      DEFAULT_FLOOR_HEIGHT[model.project.kind],
      below ? below.data.elevation + below.data.height : 0,
    ),
  };
}
