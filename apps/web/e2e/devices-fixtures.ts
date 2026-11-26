import type { Pt } from './app-modules';

/** The test's own view of walls and devices; the app's schemas are not imported here. */
export interface Wall {
  id: string;
  a: Pt;
  b: Pt;
  thickness: number;
}

export type Placement =
  | { kind: 'wall'; wallId: string; offset: number; side: 'left' | 'right'; height: number }
  | { kind: 'ceiling' | 'floor'; at: Pt; roomId?: string }
  | { kind: 'container' };

export interface Device {
  id: string;
  domain: string;
  label: string;
  type: string;
  roomId?: string;
  placement: Placement;
}

/** The point on the wall face where a wall device's marker is drawn (left is towards -y for +x). */
export function wallFace(wall: Wall, offset: number, side: 'left' | 'right'): Pt {
  const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
  const dx = (wall.b.x - wall.a.x) / length;
  const dy = (wall.b.y - wall.a.y) / length;
  const toFace = ((side === 'left' ? 1 : -1) * wall.thickness) / 2;
  return { x: wall.a.x + dx * offset + dy * toFace, y: wall.a.y + dy * offset - dx * toFace };
}

/** Where a device's marker or centre is on the plan, or null in a container or without its wall. */
export function deviceAt(walls: Readonly<Record<string, Wall>>, device: Device): Pt | null {
  const { placement } = device;
  if (placement.kind === 'container') return null;
  if (placement.kind !== 'wall') return placement.at;
  const wall = walls[placement.wallId];
  return wall ? wallFace(wall, placement.offset, placement.side) : null;
}
