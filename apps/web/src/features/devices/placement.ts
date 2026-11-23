import { resolvePlacement, type Device, type FloorData, type Pt, type Vec3 } from '@el-karta/core';

/**
 * A device drawn at its own size (furniture): its footprint centred on `center`, `size.x` wide and
 * `size.y` deep along its own axes, turned by `rotation` radians from plan +x towards +y (ADR 0008).
 */
export interface SizedFootprint {
  center: Pt;
  size: Vec3;
  rotation: number;
}

const isSolid = (size: Vec3) => size.x > 0 && size.y > 0 && size.z > 0;

/** The footprint of a floor placement with a positive `size`; every other device is a marker. */
export function sizedFootprint(device: Pick<Device, 'placement'>): SizedFootprint | null {
  const { placement } = device;
  if (placement.kind !== 'floor' || !placement.size || !isSolid(placement.size)) return null;
  return {
    center: placement.at,
    size: placement.size,
    rotation: ((placement.rotation ?? 0) * Math.PI) / 180,
  };
}

/** The four corners of a footprint, in order around it. */
export function footprintCorners({ center, size, rotation }: SizedFootprint): Pt[] {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const hx = size.x / 2;
  const hy = size.y / 2;
  return [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ].map(([x = 0, y = 0]) => ({
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  }));
}

/**
 * Where a device is drawn: its resolved position, or its approximate one while it is `flagged`.
 * Null when there is neither, so the device is not drawn.
 */
export function drawnPosition(
  floor: FloorData,
  device: Device,
): { position: Vec3; flagged: boolean } | null {
  const resolved = resolvePlacement(floor, device);
  if (resolved.ok) return { position: resolved.position, flagged: false };
  return resolved.approximate ? { position: resolved.approximate, flagged: true } : null;
}
