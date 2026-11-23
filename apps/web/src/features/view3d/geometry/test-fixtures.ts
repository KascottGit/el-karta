import {
  emptyFloorData,
  type Device,
  type FloorData,
  type Opening,
  type Placement,
  type Pt,
  type Room,
  type Wall,
} from '@el-karta/core';
import { wall } from '@/features/floorplan/walls/test-fixtures';

export { pt } from '@/features/floorplan/walls/test-fixtures';

/** A floor at `elevation` with ceiling `height`, holding what the helpers add to it. */
export class FloorFixture {
  readonly data: FloorData;

  constructor(height = 2.5, elevation = 0) {
    this.data = emptyFloorData(height, elevation);
  }

  wall(a: Pt, b: Pt, extra: Partial<Wall> = {}): Wall {
    const w = { ...wall(a, b), ...extra };
    this.data.walls[w.id] = w;
    return w;
  }

  opening(
    wallId: string,
    kind: Opening['kind'],
    offset: number,
    width: number,
    height: number,
    sill?: number,
  ) {
    const o: Opening = {
      id: crypto.randomUUID(),
      wallId,
      kind,
      offset,
      width,
      height,
      ...(sill === undefined ? {} : { sill }),
      provenance: { status: 'manual' },
    };
    this.data.openings[o.id] = o;
    return o;
  }

  room(polygon: Pt[], extra: Partial<Room> = {}): Room {
    const r: Room = {
      id: crypto.randomUUID(),
      name: 'Rum',
      type: 'other',
      polygon,
      provenance: { status: 'manual' },
      ...extra,
    };
    this.data.rooms[r.id] = r;
    return r;
  }

  device(placement: Placement, extra: Partial<Device> = {}): Device {
    const d: Device = {
      id: crypto.randomUUID(),
      domain: 'power',
      type: 'outlet',
      label: '',
      placement,
      props: {},
      ports: [],
      provenance: { status: 'manual' },
      ...extra,
    };
    this.data.devices[d.id] = d;
    return d;
  }
}
