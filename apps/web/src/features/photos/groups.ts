import type { Id } from '@el-karta/core';
import type { Attachment } from '@el-karta/data-supabase';

export interface PhotoGroup {
  /** Null for photos of the room in general (or its ceiling). */
  wallId: Id | null;
  photos: readonly Attachment[];
}

/**
 * The photos taken in `roomId`, one group per wall they face: `firstWallId` first, then the other
 * walls in the order of their first photo, then the room in general. Photos keep their order.
 */
export function photoGroups(
  photos: readonly Attachment[],
  roomId: Id,
  firstWallId?: Id,
): PhotoGroup[] {
  const byWall = new Map<Id | null, Attachment[]>();
  if (firstWallId !== undefined) byWall.set(firstWallId, []);
  for (const photo of photos) {
    if (photo.region?.roomId !== roomId) continue;
    const wallId = photo.region.wallId ?? null;
    const group = byWall.get(wallId);
    if (group) group.push(photo);
    else byWall.set(wallId, [photo]);
  }
  const groups = [...byWall].map(([wallId, list]) => ({ wallId, photos: list }));
  return [...groups.filter((g) => g.wallId !== null), ...groups.filter((g) => g.wallId === null)];
}
