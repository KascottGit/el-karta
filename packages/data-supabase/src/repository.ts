import {
  NotFoundError,
  parseFloorRecord,
  parseProjectRecord,
  ProjectKind,
  type FloorRecord,
  type Id,
  type Model,
  type ProjectRecord,
  type ProjectSummary,
  type Repository,
  type SaveResult,
} from '@el-karta/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Tables } from './database.types.ts';

export type ElKartaClient = SupabaseClient<Database>;
export type MemberRole = 'editor' | 'viewer';

export class RepositoryError extends Error {
  override name = 'RepositoryError';
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const fail = (error: { message: string; code?: string }): never => {
  throw new RepositoryError(error.message, error.code);
};

// Documents are validated by Zod on the way in and out; the database only sees JSON.
const json = (value: unknown) => value as NonNullable<Json>;

const floorFromRow = (row: Tables<'floors'>): FloorRecord =>
  parseFloorRecord({
    id: row.id,
    projectId: row.project_id,
    buildingId: row.building_id,
    name: row.name,
    sortOrder: row.sort_order,
    version: row.version,
    data: row.data,
  });

const projectFromRow = (row: Tables<'projects'>): ProjectRecord =>
  parseProjectRecord({
    id: row.id,
    name: row.name,
    kind: row.kind,
    version: row.version,
    data: row.data,
  });

/**
 * Repository over Supabase. Always pass a client signed in as the user, never the service role,
 * so row level security decides what the caller can see and change.
 */
export class SupabaseRepository implements Repository {
  constructor(private readonly client: ElKartaClient) {}

  async listProjects(): Promise<ProjectSummary[]> {
    const { data, error } = await this.client
      .from('projects')
      .select('id, name, kind')
      .order('updated_at', { ascending: false });
    if (error) fail(error);
    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      kind: ProjectKind.parse(row.kind),
    }));
  }

  async loadProject(projectId: Id): Promise<Model> {
    const [project, floors] = await Promise.all([
      this.client.from('projects').select('*').eq('id', projectId).maybeSingle(),
      this.client.from('floors').select('*').eq('project_id', projectId).order('sort_order'),
    ]);
    if (project.error) fail(project.error);
    if (floors.error) fail(floors.error);
    if (!project.data) throw new NotFoundError(`Project ${projectId} not found`);
    const records = (floors.data ?? []).map(floorFromRow);
    return {
      project: projectFromRow(project.data),
      floors: Object.fromEntries(records.map((floor) => [floor.id, floor])),
    };
  }

  async createProject(model: Model): Promise<Model> {
    const { project } = model;
    const { error } = await this.client.rpc('create_project', {
      project: json({ id: project.id, name: project.name, kind: project.kind, data: project.data }),
      floors: json(
        Object.values(model.floors).map((floor) => ({
          id: floor.id,
          buildingId: floor.buildingId,
          name: floor.name,
          sortOrder: floor.sortOrder,
          data: floor.data,
        })),
      ),
    });
    if (error) fail(error);
    return this.loadProject(project.id);
  }

  async saveProject(
    record: ProjectRecord,
    expectedVersion: number,
  ): Promise<SaveResult<ProjectRecord>> {
    const { data, error } = await this.client
      .from('projects')
      .update({
        name: record.name,
        kind: record.kind,
        data: json(record.data),
        schema_version: record.data.schemaVersion,
        version: expectedVersion + 1,
      })
      .eq('id', record.id)
      .eq('version', expectedVersion)
      .select()
      .maybeSingle();
    if (error) fail(error);
    if (data) return { ok: true, record: projectFromRow(data) };
    const latest = await this.client.from('projects').select('*').eq('id', record.id).maybeSingle();
    if (latest.error) fail(latest.error);
    if (!latest.data) throw new NotFoundError(`Project ${record.id} not found`);
    return { ok: false, latest: projectFromRow(latest.data) };
  }

  async saveFloor(record: FloorRecord, expectedVersion: number): Promise<SaveResult<FloorRecord>> {
    const { data, error } = await this.client
      .from('floors')
      .update({
        building_id: record.buildingId,
        name: record.name,
        sort_order: record.sortOrder,
        data: json(record.data),
        schema_version: record.data.schemaVersion,
        version: expectedVersion + 1,
      })
      .eq('id', record.id)
      .eq('version', expectedVersion)
      .select()
      .maybeSingle();
    if (error) fail(error);
    if (data) return { ok: true, record: floorFromRow(data) };
    const latest = await this.client.from('floors').select('*').eq('id', record.id).maybeSingle();
    if (latest.error) fail(latest.error);
    if (!latest.data) throw new NotFoundError(`Floor ${record.id} not found`);
    return { ok: false, latest: floorFromRow(latest.data) };
  }

  /** Adds an existing user (by the email they signed in with) to the project. Owners only. */
  async shareProject(projectId: Id, email: string, role: MemberRole = 'editor'): Promise<void> {
    const { error } = await this.client.rpc('share_project', {
      p_project_id: projectId,
      p_email: email,
      p_role: role,
    });
    if (error) fail(error);
  }
}
