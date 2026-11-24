import type { Id } from '@el-karta/core';
import type { SignedUrl } from '@el-karta/data-supabase';

/** A URL this close to expiring is fetched again, so it does not expire while the image loads. */
const RENEW_BEFORE_MS = 60_000;

export interface SignedUrlCache {
  get(attachmentId: Id): Promise<string>;
  /** Drops a URL that turned out not to work, so the next `get` signs a new one. */
  invalidate(attachmentId: Id): void;
}

/** Reuses each attachment's signed URL until shortly before it expires; one request at a time per attachment. */
export function createSignedUrlCache(
  sign: (attachmentId: Id) => Promise<SignedUrl>,
  now: () => number = Date.now,
): SignedUrlCache {
  const cache = new Map<Id, Promise<SignedUrl>>();
  return {
    async get(attachmentId) {
      const cached = cache.get(attachmentId);
      if (cached) {
        const signed = await cached.catch(() => null);
        if (signed && signed.expiresAt - RENEW_BEFORE_MS > now()) return signed.url;
        if (cache.get(attachmentId) !== cached) return this.get(attachmentId);
      }
      const request = sign(attachmentId);
      cache.set(attachmentId, request);
      request.catch(() => {
        if (cache.get(attachmentId) === request) cache.delete(attachmentId);
      });
      return (await request).url;
    },
    invalidate(attachmentId) {
      cache.delete(attachmentId);
    },
  };
}
