import type { Device, FloorData, Pt, Room } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { pt, wall } from '@/features/floorplan/walls/test-fixtures';
import { ceilingSite, insideRoom, movedDevice, newDeviceSite, wallSite } from './device-site';
import { newDevice, portsFrom, type DeviceTypeRef } from './new-device';

// Two walls meeting at (4, 0), 0.2 m thick, with the room on the right of both (inside, going
// clockwise on screen).
const top = wall(pt(0, 0), pt(4, 0), 0.2, 'top');
const east = wall(pt(4, 0), pt(4, 4), 0.2, 'east');
const square = (x0: number, y0: number, side: number): Pt[] => [
  pt(x0, y0),
  pt(x0 + side, y0),
  pt(x0 + side, y0 + side),
  pt(x0, y0 + side),
];
const room = (id: string, polygon: Pt[]): Room => ({
  id,
  name: id,
  type: 'other',
  polygon,
  provenance: { status: 'manual' },
});
const floor: Pick<FloorData, 'walls' | 'rooms'> = {
  walls: { top, east },
  rooms: { kitchen: room('kitchen', square(0, 0, 4)) },
};

const outlet: DeviceTypeRef = {
  domain: 'power',
  def: {
    type: 'outlet',
    labelKey: 'x',
    icon: 'x',
    placements: ['wall'],
    defaultHeight: 0.25,
    defaultPorts: [{ kind: 'power-in' }, { kind: 'data', domain: 'network' }],
    props: z.object({}),
  },
};

const onWall = (offset: number, side: 'left' | 'right', wallId = 'top'): Device =>
  newDevice(outlet, 'd', {
    placement: { kind: 'wall', wallId, offset, side, height: 0.4 },
    roomId: 'kitchen',
  });

describe('newDevice', () => {
  it('takes the type’s ports with fresh ids and their own or the device’s domain, and no props', () => {
    let n = 0;
    const device = newDevice(
      outlet,
      'id',
      { placement: { kind: 'floor', at: pt(1, 1) } },
      () => `p${++n}`,
    );
    expect(device).toEqual({
      id: 'id',
      domain: 'power',
      type: 'outlet',
      label: '',
      placement: { kind: 'floor', at: pt(1, 1) },
      props: {},
      ports: [
        { id: 'p1', domain: 'power', kind: 'power-in' },
        { id: 'p2', domain: 'network', kind: 'data' },
      ],
      provenance: { status: 'manual' },
    });
    const [a, b] = portsFrom('power', outlet.def.defaultPorts);
    expect(a!.id).not.toBe(b!.id);
  });
});

describe('wall sites', () => {
  it('attach to the face the pointer is on, at the nearest point along the wall', () => {
    expect(wallSite(floor, pt(1.5, 0.15), 0.1, 0.25)).toEqual({
      placement: { kind: 'wall', wallId: 'top', offset: 1.5, side: 'right', height: 0.25 },
      roomId: 'kitchen',
    });
    const outside = wallSite(floor, pt(2, -0.18), 0.1, 0.25);
    expect(outside?.placement).toMatchObject({ wallId: 'top', offset: 2, side: 'left' });
    expect(outside?.roomId).toBeUndefined();
  });

  it('reach as far as the given distance beyond the face, and no further', () => {
    // The face is 0.1 m from the centre line.
    expect(wallSite(floor, pt(1, 0.29), 0.2, 1)).not.toBeNull();
    expect(wallSite(floor, pt(1, 0.31), 0.2, 1)).toBeNull();
    expect(wallSite(floor, pt(2, 2), 0.2, 1)).toBeNull();
  });

  it('take the type’s default height, or 1 m without one', () => {
    expect(newDeviceSite(floor, outlet.def, pt(1, 0.1), 0.1)?.placement).toMatchObject({
      height: 0.25,
    });
    expect(
      newDeviceSite(floor, { placements: ['wall'] }, pt(1, 0.1), 0.1)?.placement,
    ).toMatchObject({ height: 1 });
  });
});

describe('ceiling sites', () => {
  it('are in the room under the pointer, and nowhere outside every room', () => {
    expect(ceilingSite(floor, pt(2, 2))).toEqual({
      placement: { kind: 'ceiling', roomId: 'kitchen', at: pt(2, 2) },
      roomId: 'kitchen',
    });
    expect(ceilingSite(floor, pt(6, 2))).toBeNull();
    expect(newDeviceSite(floor, { placements: ['ceiling'] }, pt(6, 2), 1)).toBeNull();
  });

  it('try the type’s placements in order', () => {
    const both = { placements: ['wall', 'ceiling'] as const, defaultHeight: 2 };
    expect(newDeviceSite(floor, both, pt(1, 0.1), 0.1)?.placement.kind).toBe('wall');
    expect(newDeviceSite(floor, both, pt(2, 2), 0.1)?.placement.kind).toBe('ceiling');
  });
});

describe('movedDevice', () => {
  it('slides a wall device along its wall, keeping its height, side and the reach', () => {
    const moved = movedDevice(floor, onWall(1, 'right'), pt(3, 0.1), 0.1);
    expect(moved?.placement).toEqual({
      kind: 'wall',
      wallId: 'top',
      offset: 3,
      side: 'right',
      height: 0.4,
    });
  });

  it('hops to another wall face within reach, and to the room it then faces', () => {
    const moved = movedDevice(floor, onWall(3.5, 'right'), pt(3.85, 1.5), 0.1);
    expect(moved?.placement).toMatchObject({ wallId: 'east', offset: 1.5, side: 'right' });
    expect(moved?.roomId).toBe('kitchen');
    const across = movedDevice(floor, onWall(1, 'right'), pt(1, -0.15), 0.1);
    expect(across?.placement).toMatchObject({ wallId: 'top', side: 'left' });
    // Facing out of every room, it has no room.
    expect(across && 'roomId' in across).toBe(false);
  });

  it('keeps to its own wall when the pointer is away from every wall', () => {
    const moved = movedDevice(floor, onWall(1, 'right'), pt(2.5, 2), 0.1);
    expect(moved?.placement).toMatchObject({ wallId: 'top', offset: 2.5, side: 'right' });
    expect(movedDevice(floor, onWall(1, 'right'), pt(-3, 2), 0.1)?.placement).toMatchObject({
      offset: 0,
    });
    expect(movedDevice(floor, onWall(1, 'right', 'gone'), pt(2, 2), 0.1)).toBeNull();
  });

  it('keeps a ceiling device inside its room, stopping at its outline', () => {
    const light = newDevice(outlet, 'l', {
      placement: { kind: 'ceiling', roomId: 'kitchen', at: pt(2, 2) },
    });
    expect(movedDevice(floor, light, pt(3, 1), 0.1)?.placement).toEqual({
      kind: 'ceiling',
      roomId: 'kitchen',
      at: pt(3, 1),
    });
    const stopped = movedDevice(floor, light, pt(6, 2), 0.1)?.placement;
    expect(stopped?.kind === 'ceiling' && stopped.at.x).toBeCloseTo(4, 3);
    expect(stopped?.kind === 'ceiling' && stopped.at.x).toBeLessThan(4);
    expect(stopped?.kind === 'ceiling' && stopped.at.y).toBeCloseTo(2, 3);
  });
});

describe('insideRoom', () => {
  it('is the point inside, else the nearest outline point pulled inside, else null', () => {
    const polygon = square(0, 0, 4);
    expect(insideRoom({ polygon }, pt(1, 1), pt(2, 3))).toEqual(pt(2, 3));
    const edge = insideRoom({ polygon }, pt(1, 1), pt(2, -1))!;
    expect(edge.x).toBeCloseTo(2, 3);
    expect(edge.y).toBeGreaterThan(0);
    expect(edge.y).toBeCloseTo(0, 3);
    expect(insideRoom({ polygon }, pt(5, 5), pt(6, 6))).toBeNull();
  });
});
