import { scaleFloor, type Edit, type FloorData, type Id, type Pt } from '@el-karta/core';

/** Whether anything is drawn on the floor that a new scale could leave at the wrong size. */
export const hasDrawnContent = (data: FloorData): boolean =>
  [data.walls, data.rooms, data.zones, data.devices].some((c) => Object.keys(c).length > 0) ||
  (data.grid !== undefined && data.grid.xLines.length + data.grid.yLines.length > 0);

/** Growth this close to 1 is not worth offering to rescale for. */
const SAME_SIZE = 1e-6;

export interface RescaleOffer {
  floorId: Id;
  growth: number;
  pivot: Pt;
}

/**
 * After a new scale, everything drawn on the image is the wrong size by the image's growth. Offered
 * only when something is drawn and the size changed.
 */
export function rescaleOffer(
  floorId: Id,
  before: FloorData,
  measured: { growth: number; pivot: Pt },
): RescaleOffer | null {
  if (!hasDrawnContent(before) || Math.abs(measured.growth - 1) < SAME_SIZE) return null;
  return { floorId, growth: measured.growth, pivot: measured.pivot };
}

/** Grows the drawing about the same point as the image, so it stays on the plan it was traced from. */
export const rescaleEdit = (offer: RescaleOffer): Edit =>
  scaleFloor(offer.floorId, offer.growth, offer.pivot);
