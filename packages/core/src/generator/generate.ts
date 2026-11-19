import { wallLength } from '../geometry/index.ts';
import { CURRENT_SCHEMA_VERSION } from '../migrations/index.ts';
import { emptyFloorData } from '../project.ts';
import type {
  Connection,
  Device,
  FloorData,
  FloorRecord,
  Id,
  Model,
  Placement,
  ProjectKind,
  Provenance,
  Room,
  RoomType,
  Wall,
} from '../schemas/index.ts';
import { seededRandom, seededUuid } from './random.ts';

export type SyntheticSize = 'small' | 'medium' | 'large';

interface Spec {
  name: string;
  kind: ProjectKind;
  floors: number;
  targetDevices: number;
  subPanels: number;
  width: number;
  depth: number;
  cols: number;
  rows: number;
  ceiling: number;
  roomTypes: readonly RoomType[];
  devicesPerCircuit: number;
}

export const SYNTHETIC_SPECS: Readonly<Record<SyntheticSize, Spec>> = {
  small: {
    name: 'Syntetisk villa',
    kind: 'home',
    floors: 2,
    targetDevices: 150,
    subPanels: 0,
    width: 12,
    depth: 10,
    cols: 3,
    rows: 2,
    ceiling: 2.4,
    roomTypes: ['hallway', 'kitchen', 'living_room', 'bedroom', 'bathroom', 'laundry'],
    devicesPerCircuit: 7,
  },
  medium: {
    name: 'Syntetiskt kontor',
    kind: 'office',
    floors: 5,
    targetDevices: 2000,
    subPanels: 4,
    width: 40,
    depth: 25,
    cols: 6,
    rows: 4,
    ceiling: 3,
    roomTypes: ['hallway', 'office', 'office', 'office', 'kitchen', 'bathroom'],
    devicesPerCircuit: 10,
  },
  large: {
    name: 'Syntetiskt kontorshus',
    kind: 'office',
    floors: 10,
    targetDevices: 8000,
    subPanels: 15,
    width: 50,
    depth: 40,
    cols: 8,
    rows: 6,
    ceiling: 3,
    roomTypes: [
      'hallway',
      'office',
      'office',
      'office',
      'office',
      'kitchen',
      'bathroom',
      'warehouse',
    ],
    devicesPerCircuit: 10,
  },
};

const ROOM_NAMES: Record<RoomType, string> = {
  kitchen: 'Kök',
  bathroom: 'Badrum',
  hallway: 'Hall',
  bedroom: 'Sovrum',
  living_room: 'Vardagsrum',
  laundry: 'Tvättstuga',
  office: 'Kontor',
  warehouse: 'Lager',
  technical_room: 'Teknikrum',
  other: 'Rum',
};

const PROVENANCE: Provenance = { status: 'manual', source: 'synthetic' };
const PHASES = ['L1', 'L2', 'L3'] as const;
const EXTERIOR = 0.3;
const INTERIOR = 0.12;
const DOOR_WIDTH = 0.9;

interface PanelSlot {
  device: Device;
  floorId: Id;
  label: string;
  nextSlot: number;
}

interface RoomWalls {
  room: Room;
  top: Wall;
  bottom: Wall;
  left: Wall;
  right: Wall;
  doorWall: Wall;
  doorOffset: number;
}

/**
 * Builds a deterministic project of the given size with walls, rooms, doors, panels, breakers,
 * outlets, lights and switches, wired with circuit, feeder and control connections across floors.
 */
export function generateProject(size: SyntheticSize, seed = 1): Model {
  const spec = SYNTHETIC_SPECS[size];
  const random = seededRandom(seed);
  const id = seededUuid(random);
  const projectId = id();
  const buildingId = id();
  const floors: Record<Id, FloorRecord> = {};
  const crossFloor: Record<Id, Connection> = {};
  const floorRecords: FloorRecord[] = [];
  const floorRooms: RoomWalls[][] = [];

  for (let f = 0; f < spec.floors; f++) {
    const floor: FloorRecord = {
      id: id(),
      projectId,
      buildingId,
      name: `Plan ${f + 1}`,
      sortOrder: f,
      version: 1,
      data: emptyFloorData(spec.ceiling, f * (spec.ceiling + 0.3)),
    };
    floors[floor.id] = floor;
    floorRecords.push(floor);
    floorRooms.push(buildSpace(floor.data, spec, f, id));
  }

  const ports = new Map<Id, Map<string, Id>>();
  const portOf = (device: Device, kind: string) => {
    const portId = ports.get(device.id)?.get(kind);
    if (!portId) throw new Error(`Generator bug: ${device.type} has no ${kind} port`);
    return portId;
  };
  const deviceFloor = new Map<Id, Id>();

  const addDevice = (
    floorId: Id,
    fields: Omit<Device, 'id' | 'domain' | 'ports' | 'props' | 'provenance'> & {
      props?: Device['props'];
    },
    portKinds: string[],
  ) => {
    const device: Device = {
      id: id(),
      domain: 'power',
      ports: [],
      props: {},
      provenance: PROVENANCE,
      ...fields,
    };
    const byKind = new Map<string, Id>();
    for (const kind of portKinds) {
      const port = { id: id(), domain: 'power', kind };
      device.ports.push(port);
      byKind.set(kind, port.id);
    }
    ports.set(device.id, byKind);
    deviceFloor.set(device.id, floorId);
    floors[floorId]!.data.devices[device.id] = device;
    return device;
  };

  const connect = (kind: string, from: Device, fromKind: string, to: Device, toKind: string) => {
    const connection: Connection = {
      id: id(),
      domain: 'power',
      kind,
      fromPortId: portOf(from, fromKind),
      toPortId: portOf(to, toKind),
      provenance: PROVENANCE,
    };
    const fromFloor = deviceFloor.get(from.id)!;
    if (fromFloor === deviceFloor.get(to.id))
      floors[fromFloor]!.data.connections[connection.id] = connection;
    else crossFloor[connection.id] = connection;
  };

  const placePanel = (
    floorIndex: number,
    roomIndex: number,
    type: string,
    label: string,
  ): PanelSlot => {
    const floor = floorRecords[floorIndex]!;
    const rooms = floorRooms[floorIndex]!;
    const walls = rooms[roomIndex % rooms.length]!;
    walls.room.type = 'technical_room';
    walls.room.name = `${ROOM_NAMES.technical_room} ${floorIndex + 1}${String((roomIndex % rooms.length) + 1).padStart(2, '0')}`;
    const device = addDevice(
      floor.id,
      {
        type,
        label,
        roomId: walls.room.id,
        placement: { kind: 'wall', wallId: walls.top.id, offset: 0.4, height: 1.4, side: 'right' },
      },
      ['power-in'],
    );
    return { device, floorId: floor.id, label, nextSlot: 0 };
  };

  const addBreaker = (panel: PanelSlot, circuit: string, rating: number) => {
    const n = panel.nextSlot++;
    return addDevice(
      panel.floorId,
      {
        type: 'breaker',
        label: `${panel.label}-F${n + 1}`,
        placement: { kind: 'container', parentId: panel.device.id, slot: n },
        props: { rating, poles: 1, phase: PHASES[n % 3], kind: 'MCB', circuit },
      },
      ['power-out'],
    );
  };

  const main = placePanel(0, 0, 'main_panel', 'C');
  const subs: PanelSlot[] = [];
  const perFloorCount = new Map<number, number>();
  for (let i = 0; i < spec.subPanels; i++) {
    const floorIndex = Math.floor((i * spec.floors) / spec.subPanels);
    const onFloor = perFloorCount.get(floorIndex) ?? 0;
    perFloorCount.set(floorIndex, onFloor + 1);
    const roomIndex = floorIndex === 0 ? onFloor + 1 : onFloor * Math.floor(spec.cols / 2);
    const sub = placePanel(floorIndex, roomIndex, 'sub_panel', `UC${i + 1}`);
    const source = i < 4 ? main : subs[i % 4]!;
    const feeder = addBreaker(source, `Matning ${sub.label}`, 63);
    connect('feeder', feeder, 'power-out', sub.device, 'power-in');
    subs.push(sub);
  }

  const panelsOnFloor = (f: number) => subs.filter((s) => s.floorId === floorRecords[f]!.id);
  const servingPanels = (f: number): PanelSlot[] => {
    for (let below = f; below >= 0; below--) {
      const found = panelsOnFloor(below);
      if (found.length > 0) return found;
    }
    return [main];
  };

  const panelCount = 1 + spec.subPanels;
  const loads = Math.round(
    ((spec.targetDevices - panelCount - spec.subPanels) * spec.devicesPerCircuit) /
      (spec.devicesPerCircuit + 1),
  );
  const roomsPerFloor = spec.cols * spec.rows;

  for (let f = 0; f < spec.floors; f++) {
    const floorId = floorRecords[f]!.id;
    const panels = servingPanels(f);
    const perFloor = Math.floor(loads / spec.floors) + (f < loads % spec.floors ? 1 : 0);
    let circuit: { breaker: Device; used: number } | null = null;
    let circuitPanel = -1;

    floorRooms[f]!.forEach((walls, roomIndex) => {
      const count =
        Math.floor(perFloor / roomsPerFloor) + (roomIndex < perFloor % roomsPerFloor ? 1 : 0);
      const panelIndex = Math.min(
        panels.length - 1,
        Math.floor((roomIndex * panels.length) / roomsPerFloor),
      );
      const panel = panels[panelIndex]!;
      const { room } = walls;
      const lightCount = Math.max(1, Math.round(count * 0.3));
      const outletCount = Math.max(0, count - 1 - lightCount);

      const feed = (device: Device) => {
        if (!circuit || circuit.used >= spec.devicesPerCircuit || circuitPanel !== panelIndex) {
          circuit = {
            breaker: addBreaker(panel, room.name, 10 + 6 * (random() < 0.5 ? 1 : 0)),
            used: 0,
          };
          circuitPanel = panelIndex;
        }
        circuit.used++;
        connect('circuit', circuit.breaker, 'power-out', device, 'power-in');
      };

      const lightSwitch = addDevice(
        floorId,
        {
          type: 'switch',
          label: `${room.name} strömbrytare`,
          roomId: room.id,
          placement: {
            kind: 'wall',
            wallId: walls.doorWall.id,
            offset: Math.max(0, walls.doorOffset - 0.2),
            height: 1,
            side: walls.doorWall === walls.left ? 'left' : 'right',
          },
        },
        ['power-in', 'control-out'],
      );
      feed(lightSwitch);

      for (const at of lightGrid(room, lightCount)) {
        const light = addDevice(
          floorId,
          {
            type: 'ceiling_light',
            label: `${room.name} belysning ${at.n}`,
            roomId: room.id,
            placement: { kind: 'ceiling', roomId: room.id, at: at.pt },
          },
          ['power-in', 'control-in'],
        );
        feed(light);
        connect('control', lightSwitch, 'control-out', light, 'control-in');
      }

      const sides = [
        { wall: walls.top, side: 'right' },
        { wall: walls.right, side: 'right' },
        { wall: walls.bottom, side: 'left' },
        { wall: walls.left, side: 'left' },
      ] as const;
      for (let i = 0; i < outletCount; i++) {
        const { wall, side } = sides[i % 4]!;
        const onWall = Math.ceil((outletCount - (i % 4)) / 4);
        const slot = Math.floor(i / 4);
        const placement: Placement = {
          kind: 'wall',
          wallId: wall.id,
          offset: ((slot + 1) * wallLength(wall)) / (onWall + 1),
          height: spec.kind === 'home' ? 0.2 : 0.3,
          side,
        };
        feed(
          addDevice(
            floorId,
            {
              type: 'outlet',
              label: `${room.name} uttag ${i + 1}`,
              roomId: room.id,
              placement,
              count: 2,
            },
            ['power-in'],
          ),
        );
      }
    });
  }

  return {
    project: {
      id: projectId,
      name: spec.name,
      kind: spec.kind,
      version: 1,
      data: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        buildings: { [buildingId]: { id: buildingId, name: 'Hus A' } },
        crossFloorConnections: crossFloor,
      },
    },
    floors,
  };
}

function buildSpace(
  data: FloorData,
  spec: Spec,
  floorIndex: number,
  id: () => string,
): RoomWalls[] {
  const cellW = spec.width / spec.cols;
  const cellD = spec.depth / spec.rows;
  const wall = (ax: number, ay: number, bx: number, by: number, exterior: boolean): Wall => {
    const w: Wall = {
      id: id(),
      a: { x: ax, y: ay },
      b: { x: bx, y: by },
      thickness: exterior ? EXTERIOR : INTERIOR,
      provenance: PROVENANCE,
    };
    data.walls[w.id] = w;
    return w;
  };
  const horizontal = Array.from({ length: spec.rows + 1 }, (_, j) =>
    Array.from({ length: spec.cols }, (_, c) =>
      wall(c * cellW, j * cellD, (c + 1) * cellW, j * cellD, j === 0 || j === spec.rows),
    ),
  );
  const vertical = Array.from({ length: spec.cols + 1 }, (_, i) =>
    Array.from({ length: spec.rows }, (_, r) =>
      wall(i * cellW, r * cellD, i * cellW, (r + 1) * cellD, i === 0 || i === spec.cols),
    ),
  );
  const opening = (wallId: Id, kind: 'door' | 'window', length: number) => {
    const width = kind === 'door' ? DOOR_WIDTH : 1.2;
    const offset = length / 2 - width / 2;
    const o = {
      id: id(),
      wallId,
      kind,
      offset,
      width,
      height: kind === 'door' ? 2.1 : 1.2,
      provenance: PROVENANCE,
    };
    data.openings[o.id] =
      kind === 'window' ? { ...o, sill: 0.9 } : { ...o, hinge: 'left', swing: 'in' };
    return offset;
  };

  const rooms: RoomWalls[] = [];
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      const index = r * spec.cols + c;
      const type = spec.roomTypes[index % spec.roomTypes.length]!;
      const x0 = c * cellW;
      const y0 = r * cellD;
      const room: Room = {
        id: id(),
        name: `${ROOM_NAMES[type]} ${floorIndex + 1}${String(index + 1).padStart(2, '0')}`,
        type,
        polygon: [
          { x: x0, y: y0 },
          { x: x0 + cellW, y: y0 },
          { x: x0 + cellW, y: y0 + cellD },
          { x: x0, y: y0 + cellD },
        ],
        provenance: PROVENANCE,
      };
      data.rooms[room.id] = room;
      const top = horizontal[r]![c]!;
      const bottom = horizontal[r + 1]![c]!;
      const left = vertical[c]![r]!;
      const right = vertical[c + 1]![r]!;
      const doorWall = c > 0 ? left : r > 0 ? top : left;
      const doorOffset =
        c > 0 || r > 0
          ? opening(doorWall.id, 'door', c > 0 ? cellD : cellW)
          : opening(doorWall.id, 'door', cellD);
      if (r === 0) opening(top.id, 'window', cellW);
      if (r === spec.rows - 1) opening(bottom.id, 'window', cellW);
      rooms.push({ room, top, bottom, left, right, doorWall, doorOffset });
    }
  }
  return rooms;
}

function lightGrid(room: Room, count: number): { n: number; pt: { x: number; y: number } }[] {
  const [min, , max] = room.polygon as [Room['polygon'][0], unknown, Room['polygon'][0]];
  const w = max.x - min.x;
  const d = max.y - min.y;
  const cols = Math.max(1, Math.ceil(Math.sqrt((count * w) / d)));
  const rows = Math.ceil(count / cols);
  return Array.from({ length: count }, (_, i) => ({
    n: i + 1,
    pt: {
      x: min.x + ((i % cols) + 0.5) * (w / cols),
      y: min.y + (Math.floor(i / cols) + 0.5) * (d / rows),
    },
  }));
}
