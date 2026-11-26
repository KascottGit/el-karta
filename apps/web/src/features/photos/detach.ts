import { combine, putDevice, type Edit, type FloorData, type Id } from '@el-karta/core';

/**
 * One edit that removes a deleted photo from the evidence of every device on the floor, dropping
 * `attachmentIds` where it was the last; null when no device refers to it.
 */
export function detachPhoto(floor: Pick<FloorData, 'devices'>, photoId: Id): Edit | null {
  const edits = Object.values(floor.devices)
    .filter((d) => d.attachmentIds?.includes(photoId))
    .map(({ attachmentIds = [], ...device }) => {
      const left = attachmentIds.filter((id) => id !== photoId);
      return putDevice(left.length > 0 ? { ...device, attachmentIds: left } : device);
    });
  return edits.length > 0 ? combine(...edits) : null;
}
