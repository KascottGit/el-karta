import {
  AttachmentRegion,
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
export type AttachmentKind = 'floorplan' | 'photo' | 'panel_photo' | 'breaker_list';
type FileBody = Parameters<ReturnType<ElKartaClient['storage']['from']>['upload']>[1];

/** The storage bucket for every project file; objects live under `<projectId>/` (ADR 0004). */
export const PROJECT_FILES_BUCKET = 'project-files';

export interface NewAttachment {
  /** Chosen by the caller, like floor ids, so the model can refer to it before the upload ends. */
  id: Id;
  projectId: Id;
  floorId?: Id;
  kind: AttachmentKind;
  /** File extension without the dot, such as `png`; part of the storage path. */
  extension: string;
  contentType: string;
  body: FileBody;
  /** What a photo shows; validated before anything is stored. */
  region?: AttachmentRegion;
}

/** An attachment row as stored. */
export interface Attachment {
  id: Id;
  projectId: Id;
  floorId: Id | null;
  kind: AttachmentKind;
  storagePath: string;
  /** Null when the row has none, or one that is not a valid `AttachmentRegion`. */
  region: AttachmentRegion | null;
  /** ISO timestamp. */
  createdAt: string;
}

export interface SignedUrl {
  url: string;
  /** Milliseconds since the epoch, as `Date.now()`. */
  expiresAt: number;
}

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

export const attachmentPath = (projectId: Id, attachmentId: Id, extension: string) => {
  if (!/^[a-z0-9]{1,8}$/.test(extension)) throw new RepositoryError(`Bad extension "${extension}"`);
  return `${projectId}/${attachmentId}.${extension}`;
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

const attachmentFromRow = (row: Tables<'attachments'>): Attachment => {
  const region = row.region === null ? null : AttachmentRegion.safeParse(row.region);
  return {
    id: row.id,
    projectId: row.project_id,
    floorId: row.floor_id,
    kind: row.kind as AttachmentKind,
    storagePath: row.storage_path,
    region: region?.success ? region.data : null,
    createdAt: row.created_at,
  };
};

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

  async createFloor(record: FloorRecord): Promise<FloorRecord> {
    const { data, error } = await this.client
      .from('floors')
      .insert({
        id: record.id,
        project_id: record.projectId,
        building_id: record.buildingId,
        name: record.name,
        sort_order: record.sortOrder,
        data: json(record.data),
        schema_version: record.data.schemaVersion,
        version: record.version,
      })
      .select()
      .single();
    if (error) fail(error);
    return floorFromRow(data!);
  }

  async deleteFloor(projectId: Id, floorId: Id): Promise<void> {
    const { data, error } = await this.client
      .from('floors')
      .delete()
      .eq('id', floorId)
      .eq('project_id', projectId)
      .select('id');
    if (error) fail(error);
    if (!data?.length) throw new NotFoundError(`Floor ${floorId} not found`);
  }

  /**
   * Stores a file in the project's storage folder and records it as an attachment, both as the
   * signed-in user: only owners and editors can. If the row cannot be added, the file is removed.
   */
  async uploadAttachment(attachment: NewAttachment): Promise<{ storagePath: string }> {
    const region =
      attachment.region === undefined ? null : AttachmentRegion.parse(attachment.region);
    const storagePath = attachmentPath(attachment.projectId, attachment.id, attachment.extension);
    const files = this.client.storage.from(PROJECT_FILES_BUCKET);
    const uploaded = await files.upload(storagePath, attachment.body, {
      contentType: attachment.contentType,
      upsert: false,
    });
    if (uploaded.error) throw new RepositoryError(uploaded.error.message);
    const { error } = await this.client.from('attachments').insert({
      id: attachment.id,
      project_id: attachment.projectId,
      floor_id: attachment.floorId ?? null,
      kind: attachment.kind,
      storage_path: storagePath,
      region: region === null ? null : json(region),
    });
    if (error) {
      await files.remove([storagePath]);
      fail(error);
    }
    return { storagePath };
  }

  /** A time-limited URL for reading an attachment's file. Any project member can get one. */
  async attachmentUrl(attachmentId: Id, expiresInSeconds = 3600): Promise<SignedUrl> {
    const { data, error } = await this.client
      .from('attachments')
      .select('storage_path')
      .eq('id', attachmentId)
      .maybeSingle();
    if (error) fail(error);
    if (!data) throw new NotFoundError(`Attachment ${attachmentId} not found`);
    const requestedAt = Date.now();
    const signed = await this.client.storage
      .from(PROJECT_FILES_BUCKET)
      .createSignedUrl(data.storage_path, expiresInSeconds);
    if (signed.error) throw new RepositoryError(signed.error.message);
    return { url: signed.data.signedUrl, expiresAt: requestedAt + expiresInSeconds * 1000 };
  }

  /** The floor's attachments of one kind that the caller can read, oldest first. */
  async listAttachments(floorId: Id, kind: AttachmentKind): Promise<Attachment[]> {
    const { data, error } = await this.client
      .from('attachments')
      .select('*')
      .eq('floor_id', floorId)
      .eq('kind', kind)
      .order('created_at')
      .order('id');
    if (error) fail(error);
    return (data ?? []).map(attachmentFromRow);
  }

  /**
   * Deletes an attachment's row, then its file. Owners and editors only; for anyone else, or an
   * unknown id, nothing is deleted and it throws `NotFoundError`. The row goes first, so a failed
   * file removal leaves an unreachable file rather than a row without one.
   */
  async deleteAttachment(attachmentId: Id): Promise<void> {
    const { data, error } = await this.client
      .from('attachments')
      .delete()
      .eq('id', attachmentId)
      .select('storage_path');
    if (error) fail(error);
    const row = data?.[0];
    if (!row) throw new NotFoundError(`Attachment ${attachmentId} not found`);
    const removed = await this.client.storage.from(PROJECT_FILES_BUCKET).remove([row.storage_path]);
    if (removed.error) throw new RepositoryError(removed.error.message);
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
