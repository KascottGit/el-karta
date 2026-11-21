import type { Id } from '@el-karta/core';
import type { z } from 'zod';

/**
 * Small JSON files kept beside a project's attachments in Storage, at `<projectId>/<name>.json`,
 * for derived data that belongs to an attachment or a floor but not in the model (the page size of
 * a rendered PDF, an AI reading). Storage policies give members read and writers write access.
 */
export interface ProjectJson {
  save(projectId: Id, name: string, value: unknown): Promise<void>;
  /**
   * The parsed file, or null when it is missing or does not fit `schema`. Any other failure
   * throws, so a lost connection is never taken for "there is nothing".
   */
  load<T>(projectId: Id, name: string, schema: z.ZodType<T>): Promise<T | null>;
}

/** The part of a Storage bucket the files need. */
export interface JsonBucket {
  upload(
    path: string,
    body: Blob,
    options: { contentType: string; upsert: boolean; cacheControl: string },
  ): Promise<{ error: unknown }>;
  download(path: string): Promise<{ data: Blob | null; error: unknown }>;
}

/** Storage answers a missing object (or one the user may not see) with status or code 404. */
export function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  return status === 404 || String(statusCode) === '404';
}

const path = (projectId: Id, name: string) => `${projectId}/${name}.json`;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : `Storage failed: ${String(error)}`;

export function createBucketJson(bucket: () => Promise<JsonBucket>): ProjectJson {
  return {
    async save(projectId, name, value) {
      const body = new Blob([JSON.stringify(value)], { type: 'application/json' });
      // The same path is overwritten, so a cached copy would hide the newer file.
      const { error } = await (
        await bucket()
      ).upload(path(projectId, name), body, {
        contentType: 'application/json',
        upsert: true,
        cacheControl: '0',
      });
      if (error) throw new Error(messageOf(error));
    },
    async load(projectId, name, schema) {
      const { data, error } = await (await bucket()).download(path(projectId, name));
      if (!data) {
        if (isNotFound(error)) return null;
        throw new Error(messageOf(error));
      }
      let raw: unknown;
      try {
        raw = JSON.parse(await data.text());
      } catch {
        return null;
      }
      const parsed = schema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
  };
}

// Loaded on first use, so the editor's extensions can be imported without a Supabase client, as
// unit tests and the synthetic dev page do.
export const storageJson = createBucketJson(async () => {
  const [{ supabase }, { PROJECT_FILES_BUCKET }] = await Promise.all([
    import('@/app/supabase'),
    import('@el-karta/data-supabase'),
  ]);
  return supabase.storage.from(PROJECT_FILES_BUCKET);
});

/** Keeps the files in memory, for unit tests. */
export function createMemoryJson(): ProjectJson & { files: Map<string, unknown> } {
  const files = new Map<string, unknown>();
  return {
    files,
    save(projectId, name, value) {
      files.set(path(projectId, name), JSON.parse(JSON.stringify(value)));
      return Promise.resolve();
    },
    load(projectId, name, schema) {
      const parsed = schema.safeParse(files.get(path(projectId, name)));
      return Promise.resolve(parsed.success ? parsed.data : null);
    },
  };
}
