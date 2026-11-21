import type { Id } from '@el-karta/core';
import type { z } from 'zod';

/**
 * Small JSON files kept beside a project's attachments in Storage, at `<projectId>/<name>.json`,
 * for derived data that belongs to an attachment or a floor but not in the model (the page size of
 * a rendered PDF, an AI reading). Storage policies give members read and writers write access.
 */
export interface ProjectJson {
  save(projectId: Id, name: string, value: unknown): Promise<void>;
  /** The parsed file, or null when it is missing or does not fit `schema`. */
  load<T>(projectId: Id, name: string, schema: z.ZodType<T>): Promise<T | null>;
}

// Loaded on first use, so the editor's extensions can be imported without a Supabase client, as
// unit tests and the synthetic dev page do.
const bucket = async () => {
  const [{ supabase }, { PROJECT_FILES_BUCKET }] = await Promise.all([
    import('@/app/supabase'),
    import('@el-karta/data-supabase'),
  ]);
  return supabase.storage.from(PROJECT_FILES_BUCKET);
};

const path = (projectId: Id, name: string) => `${projectId}/${name}.json`;

export const storageJson: ProjectJson = {
  async save(projectId, name, value) {
    const body = new Blob([JSON.stringify(value)], { type: 'application/json' });
    const { error } = await (
      await bucket()
    ).upload(path(projectId, name), body, {
      contentType: 'application/json',
      upsert: true,
    });
    if (error) throw new Error(error.message);
  },
  async load(projectId, name, schema) {
    try {
      const { data, error } = await (await bucket()).download(path(projectId, name));
      if (error) return null;
      const parsed = schema.safeParse(JSON.parse(await data.text()));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  },
};

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
