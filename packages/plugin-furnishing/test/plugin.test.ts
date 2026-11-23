import { Device, createRegistry, validateModel } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { ModelBuilder } from '../../core/test/builder.ts';
import {
  FURNISHING_DOMAIN,
  FURNITURE_SIZES,
  FURNITURE_TYPES,
  furnishingPlugin,
  isFurniture,
  newFurniture,
} from '../src/index.ts';

const registry = createRegistry([furnishingPlugin]);

describe('furnishingPlugin', () => {
  it('registers every furniture type for floor placement only, without ports', () => {
    expect(registry.plugin(FURNISHING_DOMAIN)).toBe(furnishingPlugin);
    for (const type of FURNITURE_TYPES) {
      const def = registry.deviceType(FURNISHING_DOMAIN, type);
      expect(def?.placements).toEqual(['floor']);
      expect(def?.defaultPorts).toEqual([]);
      expect(def?.labelKey).toBe(`devices.types.furnishing.${type}`);
    }
    expect(furnishingPlugin.deviceTypes.map((d) => d.type)).toEqual([...FURNITURE_TYPES]);
  });

  it('has a positive default size for every type, in metres', () => {
    for (const type of FURNITURE_TYPES) {
      const { x, y, z } = FURNITURE_SIZES[type];
      for (const v of [x, y, z]) {
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(3);
      }
    }
    expect(FURNITURE_SIZES.bed.y).toBeGreaterThan(FURNITURE_SIZES.bed.x);
  });

  it('builds new furniture that matches the schema at its default size', () => {
    const b = new ModelBuilder();
    const device = newFurniture({ id: b.id(), type: 'desk', at: { x: 2, y: 3 } });
    expect(Device.parse(device)).toEqual(device);
    expect(device.placement).toEqual({
      kind: 'floor',
      at: { x: 2, y: 3 },
      rotation: 0,
      size: FURNITURE_SIZES.desk,
    });
    expect(device.placement.kind === 'floor' && device.placement.size).not.toBe(
      FURNITURE_SIZES.desk,
    );
    expect('roomId' in device).toBe(false);
    expect(isFurniture(device)).toBe(true);
    expect(isFurniture({ domain: 'power', type: 'desk' })).toBe(false);
  });

  it('validates placed furniture without issues', () => {
    const b = new ModelBuilder();
    const room = b.room(0, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    const floor = b.floors[0]!;
    for (const [i, type] of FURNITURE_TYPES.entries()) {
      const device = newFurniture({ id: b.id(), type, at: { x: 0.5 + i * 0.4, y: 2 } });
      if (device.placement.kind === 'floor') device.placement.rotation = i * 30;
      floor.data.devices[device.id] = { ...device, roomId: room.id, label: `${type} ${i}` };
    }
    expect(validateModel(b.build(), registry)).toEqual([]);
  });

  it('flags furniture in a place or with props it does not allow', () => {
    const b = new ModelBuilder();
    const wall = b.wall(0, { x: 0, y: 0 }, { x: 4, y: 0 });
    const onWall = b.device(
      0,
      'shelf',
      { kind: 'wall', wallId: wall.id, offset: 1, height: 1, side: 'left' },
      [],
      { domain: FURNISHING_DOMAIN },
    );
    const withProps = b.floorDevice(0, 'desk', [], {
      domain: FURNISHING_DOMAIN,
      props: { colour: 'red' },
    });
    const codes = validateModel(b.build(), registry).map((i) => [i.code, i.ids[0]]);
    expect(codes).toEqual(
      expect.arrayContaining([
        ['device.placement-not-allowed', onWall.id],
        ['device.props-invalid', withProps.id],
      ]),
    );
  });
});
