import type { Device, Id, Pt, Room } from '@el-karta/core';
import type { Attachment } from '@el-karta/data-supabase';
import { projectWith, pt, wall } from '@/features/floorplan/walls/test-fixtures';
import replyText from '../../../e2e/fixtures/ai-photo-reply.json?raw';

/**
 * The fake provider's photo reply in the e2e test: two outlets and a switch on wall A, placed
 * roughly between its floor corners at the photo's left and right edges.
 */
export const photoReply = (): unknown => JSON.parse(replyText);

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  pt(x0, y0),
  pt(x1, y0),
  pt(x1, y1),
  pt(x0, y1),
];

const room = (id: string, name: string, polygon: Pt[]): Room => ({
  id,
  name,
  type: 'other',
  polygon,
  provenance: { status: 'manual' },
});

export const ID = {
  kitchen: '00000000-0000-4000-8000-000000000001',
  hall: '00000000-0000-4000-8000-000000000002',
  shared: '00000000-0000-4000-8000-000000000011',
  outer: '00000000-0000-4000-8000-000000000012',
  loose: '00000000-0000-4000-8000-000000000013',
} as const;

/**
 * A kitchen (0–4 m) and a hall (4–8 m) side by side, 3 m deep: `shared` is the wall between them,
 * `outer` the kitchen's top wall, and `loose` a wall away from both.
 */
export function twoRooms() {
  const project = projectWith([
    wall(pt(4, 0), pt(4, 3), 0.2, ID.shared),
    wall(pt(0, 0), pt(4, 0), 0.2, ID.outer),
    wall(pt(10, 0), pt(12, 0), 0.2, ID.loose),
  ]);
  const floor = project.model.floors[project.floorId]!;
  // `projectWith` shares the device record between its two floors.
  floor.data.devices = {};
  floor.data.rooms = {
    [ID.kitchen]: room(ID.kitchen, 'Kök', rect(0, 0, 4, 3)),
    [ID.hall]: room(ID.hall, 'Hall', rect(4, 0, 8, 3)),
  };
  return project;
}

export const WALLED = {
  bottom: '00000000-0000-4000-8000-000000000014',
  left: '00000000-0000-4000-8000-000000000015',
  window: '00000000-0000-4000-8000-000000000021',
  door: '00000000-0000-4000-8000-000000000022',
} as const;

/**
 * `twoRooms` with the kitchen closed by a bottom and a left wall, so its walls clockwise from the
 * top are `outer`, `shared`, `bottom` and `left`. The top wall has a window 1.00 m wide, the
 * shared wall a door into the hall.
 */
export function walledKitchen() {
  const project = twoRooms();
  const data = project.model.floors[project.floorId]!.data;
  for (const w of [
    wall(pt(4, 3), pt(0, 3), 0.2, WALLED.bottom),
    wall(pt(0, 3), pt(0, 0), 0.2, WALLED.left),
  ])
    data.walls[w.id] = w;
  data.openings = {
    [WALLED.window]: {
      id: WALLED.window,
      wallId: ID.outer,
      kind: 'window',
      offset: 1,
      width: 1,
      height: 1.2,
      sill: 0.9,
      provenance: { status: 'manual' },
    },
    [WALLED.door]: {
      id: WALLED.door,
      wallId: ID.shared,
      kind: 'door',
      offset: 1,
      width: 0.9,
      height: 2.1,
      hinge: 'left',
      swing: 'in',
      provenance: { status: 'manual' },
    },
  };
  return project;
}

export const outlet = (id: Id, attachmentIds?: Id[]): Device => ({
  id,
  domain: 'power',
  type: 'outlet',
  label: '',
  placement: { kind: 'wall', wallId: ID.outer, offset: 1, side: 'right', height: 0.25 },
  props: {},
  ports: [],
  provenance: { status: 'manual' },
  ...(attachmentIds ? { attachmentIds } : {}),
});

export const photo = (
  id: Id,
  floorId: Id,
  region: Attachment['region'],
  createdAt = '2026-11-24T10:00:00Z',
): Attachment => ({
  id,
  projectId: '00000000-0000-4000-8000-0000000000ff',
  floorId,
  kind: 'photo',
  storagePath: `p/${id}.jpg`,
  region,
  createdAt,
});
