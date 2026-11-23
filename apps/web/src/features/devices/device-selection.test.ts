import { addDevice, applyEdit, putSpaceItem, type Device, type Room } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { projectWith, pt } from '@/features/floorplan/walls/test-fixtures';
import { deviceRoomName } from './device-selection';

const room: Room = {
  id: 'room',
  name: 'Kök',
  type: 'kitchen',
  polygon: [pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4)],
  provenance: { status: 'manual' },
};

const device = (id: string, placement: Device['placement'], roomId?: string): Device => ({
  id,
  domain: 'power',
  type: 'ceiling_light',
  label: id,
  ...(roomId ? { roomId } : {}),
  placement,
  props: {},
  ports: [],
  provenance: { status: 'manual' },
});

describe('deviceRoomName', () => {
  it('is the room the device belongs to, else the room whose ceiling it hangs from', () => {
    const { model, floorId } = projectWith();
    let next = applyEdit(model, putSpaceItem(floorId, 'rooms', room)).model;
    for (const d of [
      device('member', { kind: 'floor', at: pt(1, 1) }, 'room'),
      device('ceiling', { kind: 'ceiling', roomId: 'room', at: pt(2, 2) }),
      device('loose', { kind: 'floor', at: pt(9, 9) }),
      device('lost', { kind: 'floor', at: pt(1, 1) }, 'gone'),
    ]) {
      next = applyEdit(next, addDevice(floorId, d)).model;
    }
    const floor = next.floors[floorId]!;
    const name = (id: string) => deviceRoomName(floor, floor.data.devices[id]!);
    expect(name('member')).toBe('Kök');
    expect(name('ceiling')).toBe('Kök');
    expect(name('loose')).toBeUndefined();
    expect(name('lost')).toBeUndefined();
  });
});
