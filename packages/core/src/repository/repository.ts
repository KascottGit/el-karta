import type { FloorRecord, Id, Model, ProjectKind, ProjectRecord } from '../schemas/index.ts';

export interface ProjectSummary {
  id: Id;
  name: string;
  kind: ProjectKind;
}

/** A conflict means someone else saved first; `latest` is their version to replay onto. */
export type SaveResult<T> = { ok: true; record: T } | { ok: false; latest: T };

export interface Repository {
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(projectId: Id): Promise<Model>;
  createProject(model: Model): Promise<Model>;
  saveProject(record: ProjectRecord, expectedVersion: number): Promise<SaveResult<ProjectRecord>>;
  saveFloor(record: FloorRecord, expectedVersion: number): Promise<SaveResult<FloorRecord>>;
  /** Stores a new floor row immediately (not a queued change) and returns it as stored. */
  createFloor(record: FloorRecord): Promise<FloorRecord>;
  /** Deletes a floor row immediately. Throws `NotFoundError` if it does not exist or the caller may not delete it. */
  deleteFloor(projectId: Id, floorId: Id): Promise<void>;
}

export class NotFoundError extends Error {
  override name = 'NotFoundError';
}
