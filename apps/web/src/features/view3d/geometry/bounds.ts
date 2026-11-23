import type { Bounds3, Box, DeviceTransform, RoomSlab, WallPiece } from './types';

class BoundsBuilder {
  #min = { x: Infinity, y: Infinity, z: Infinity };
  #max = { x: -Infinity, y: -Infinity, z: -Infinity };

  point(x: number, y: number, z: number) {
    const min = this.#min;
    const max = this.#max;
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
    max.z = Math.max(max.z, z);
  }

  box({ center, size, rotation }: Box) {
    const cos = Math.abs(Math.cos(rotation));
    const sin = Math.abs(Math.sin(rotation));
    const hx = (cos * size.x + sin * size.y) / 2;
    const hy = (sin * size.x + cos * size.y) / 2;
    this.point(center.x - hx, center.y - hy, center.z - size.z / 2);
    this.point(center.x + hx, center.y + hy, center.z + size.z / 2);
  }

  result(): Bounds3 | null {
    return this.#min.x === Infinity ? null : { min: { ...this.#min }, max: { ...this.#max } };
  }
}

/** The floor-local bounds of everything drawn for one floor. */
export function floorBounds(
  walls: readonly WallPiece[],
  slabs: readonly RoomSlab[],
  devices: readonly DeviceTransform[],
): Bounds3 | null {
  const b = new BoundsBuilder();
  for (const piece of walls) b.box(piece);
  for (const slab of slabs) for (const p of slab.outline) b.point(p.x, p.y, 0);
  for (const d of devices) {
    if (d.kind === 'box') b.box(d);
    else b.point(d.position.x, d.position.y, d.position.z);
  }
  return b.result();
}

/** The bounds of the visible floors, each raised to its base from `floorBases`. */
export function stackedBounds(
  floors: readonly { bounds: Bounds3 | null; base: number }[],
): Bounds3 | null {
  const b = new BoundsBuilder();
  for (const { bounds, base } of floors) {
    if (!bounds) continue;
    b.point(bounds.min.x, bounds.min.y, bounds.min.z + base);
    b.point(bounds.max.x, bounds.max.y, bounds.max.z + base);
  }
  return b.result();
}
