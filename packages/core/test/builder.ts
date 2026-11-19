import { seededRandom, seededUuid } from '../src/generator/random.ts';
import { CURRENT_SCHEMA_VERSION } from '../src/migrations/index.ts';
import { emptyFloorData } from '../src/project.ts';
import type {
  Connection,
  Device,
  FloorRecord,
  Id,
  Model,
  Placement,
  Pt,
  Room,
  Wall,
} from '../src/schemas/index.ts';

export type BuiltDevice = Device & { port: (kind: string) => Id };

/** Hand-built models for tests. Mutates its own model until `build()` is called. */
export class ModelBuilder {
  readonly id = seededUuid(seededRandom(42));
  readonly floors: FloorRecord[] = [];
  readonly #model: Model;
  readonly #portFloor = new Map<Id, FloorRecord>();

  constructor(floorCount = 1, floorHeight = 2.5) {
    const projectId = this.id();
    const buildingId = this.id();
    const floors: Record<Id, FloorRecord> = {};
    for (let i = 0; i < floorCount; i++) {
      const floor: FloorRecord = {
        id: this.id(),
        projectId,
        buildingId,
        name: `Plan ${i + 1}`,
        sortOrder: i,
        version: 1,
        data: emptyFloorData(floorHeight, i * 3),
      };
      floors[floor.id] = floor;
      this.floors.push(floor);
    }
    this.#model = {
      project: {
        id: projectId,
        name: 'Test',
        kind: 'home',
        version: 1,
        data: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          buildings: { [buildingId]: { id: buildingId, name: 'Hus' } },
          crossFloorConnections: {},
        },
      },
      floors,
    };
  }

  wall(floor: number, a: Pt, b: Pt, thickness = 0.2): Wall {
    const wall: Wall = { id: this.id(), a, b, thickness, provenance: { status: 'manual' } };
    this.#floor(floor).data.walls[wall.id] = wall;
    return wall;
  }

  room(floor: number, polygon: Pt[], extra: Partial<Room> = {}): Room {
    const room: Room = {
      id: this.id(),
      name: 'Rum',
      type: 'other',
      polygon,
      provenance: { status: 'manual' },
      ...extra,
    };
    this.#floor(floor).data.rooms[room.id] = room;
    return room;
  }

  device(
    floor: number,
    type: string,
    placement: Placement,
    portKinds: string[] = [],
    extra: Partial<Omit<Device, 'id' | 'ports'>> = {},
  ): BuiltDevice {
    const domain = extra.domain ?? 'power';
    const ports = portKinds.map((kind) => ({ id: this.id(), domain, kind }));
    const device: Device = {
      id: this.id(),
      domain,
      type,
      label: type,
      placement,
      props: {},
      ports,
      provenance: { status: 'manual' },
      ...extra,
    };
    this.#floor(floor).data.devices[device.id] = device;
    for (const port of ports) this.#portFloor.set(port.id, this.#floor(floor));
    return Object.assign(
      { ...device },
      {
        port: (kind: string) => {
          const port = ports.find((p) => p.kind === kind);
          if (!port) throw new Error(`No ${kind} port on ${type}`);
          return port.id;
        },
      },
    );
  }

  floorDevice(
    floor: number,
    type: string,
    portKinds: string[] = [],
    extra: Partial<Omit<Device, 'id' | 'ports'>> = {},
  ) {
    return this.device(floor, type, { kind: 'floor', at: { x: 1, y: 1 } }, portKinds, extra);
  }

  connect(
    kind: string,
    from: BuiltDevice,
    fromKind: string,
    to: BuiltDevice,
    toKind: string,
    domain = 'power',
  ): Connection {
    const connection: Connection = {
      id: this.id(),
      domain,
      kind,
      fromPortId: from.port(fromKind),
      toPortId: to.port(toKind),
      provenance: { status: 'manual' },
    };
    const fromFloor = this.#portFloor.get(connection.fromPortId);
    if (fromFloor && fromFloor === this.#portFloor.get(connection.toPortId)) {
      fromFloor.data.connections[connection.id] = connection;
    } else {
      this.#model.project.data.crossFloorConnections[connection.id] = connection;
    }
    return connection;
  }

  build(): Model {
    return JSON.parse(JSON.stringify(this.#model)) as Model;
  }

  #floor(index: number): FloorRecord {
    const floor = this.floors[index];
    if (!floor) throw new Error(`No floor ${index}`);
    return floor;
  }
}
