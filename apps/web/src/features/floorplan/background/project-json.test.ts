import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createBucketJson, type JsonBucket } from './project-json';

const Value = z.object({ n: z.number() });

function fakeBucket(download: Awaited<ReturnType<JsonBucket['download']>>) {
  const uploads: { path: string; options: unknown; body: Blob }[] = [];
  const bucket: JsonBucket = {
    upload: (path, body, options) => {
      uploads.push({ path, body, options });
      return Promise.resolve({ error: null });
    },
    download: () => Promise.resolve(download),
  };
  return { json: createBucketJson(() => Promise.resolve(bucket)), uploads };
}

const blob = (text: string) => new Blob([text], { type: 'application/json' });

describe('project JSON files in Storage', () => {
  it('overwrites the file without letting a cache serve the old one', async () => {
    const { json, uploads } = fakeBucket({ data: null, error: null });
    await json.save('p', 'ai-import/f', { n: 1 });
    expect(uploads[0]).toMatchObject({
      path: 'p/ai-import/f.json',
      options: { upsert: true, cacheControl: '0', contentType: 'application/json' },
    });
    expect(JSON.parse(await uploads[0]!.body.text())).toEqual({ n: 1 });
  });

  it('reads a file back, and a missing or unreadable one as null', async () => {
    expect(
      await fakeBucket({ data: blob('{"n":2}'), error: null }).json.load('p', 'x', Value),
    ).toEqual({ n: 2 });
    // How Storage answers a missing object.
    const missing = { status: 400, statusCode: '404', message: 'Object not found' };
    expect(await fakeBucket({ data: null, error: missing }).json.load('p', 'x', Value)).toBeNull();
    expect(
      await fakeBucket({ data: blob('{"n":"two"}'), error: null }).json.load('p', 'x', Value),
    ).toBeNull();
    expect(
      await fakeBucket({ data: blob('not json'), error: null }).json.load('p', 'x', Value),
    ).toBeNull();
  });

  it('throws on any other failure, so a lost connection is not taken for no file', async () => {
    const offline = new Error('Failed to fetch');
    await expect(
      fakeBucket({ data: null, error: offline }).json.load('p', 'x', Value),
    ).rejects.toThrow('Failed to fetch');
    const denied = { status: 500, statusCode: '500', message: 'boom' };
    await expect(
      fakeBucket({ data: null, error: denied }).json.load('p', 'x', Value),
    ).rejects.toThrow();
  });
});
