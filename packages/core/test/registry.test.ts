import { describe, expect, it } from 'vitest';
import { CONTAINS, createRegistry, RegistryError } from '../src/index.ts';
import { ModelBuilder } from './builder.ts';
import { testNetwork, testPower } from './plugins.ts';

describe('plugin registry', () => {
  it('looks up plugins, device types, connection kinds and trace kinds', () => {
    const registry = createRegistry([testPower, testNetwork]);
    expect(registry.plugin('network')).toBe(testNetwork);
    expect(registry.deviceType('power', 'breaker')?.placements).toEqual(['container']);
    expect(registry.deviceType('network', 'breaker')).toBeUndefined();
    expect(registry.connectionKind('power', 'control')?.toPortKinds).toEqual(['control-in']);
    expect(registry.traceKinds('power')).toEqual(new Set(['circuit', 'feeder', CONTAINS]));
    expect(registry.traceKinds('unknown').size).toBe(0);
  });

  it('rejects duplicate registrations', () => {
    expect(() => createRegistry([testPower, testPower])).toThrow(RegistryError);
    expect(() =>
      createRegistry([
        { ...testPower, deviceTypes: [...testPower.deviceTypes, testPower.deviceTypes[0]!] },
      ]),
    ).toThrow('Duplicate device type in power: main_panel');
  });

  it('resolves internal port links, or null when all ports are joined', () => {
    const registry = createRegistry([testPower, testNetwork]);
    const b = new ModelBuilder();
    const patch = b.floorDevice(0, 'patch_panel', ['front', 'back'], { domain: 'network' });
    const outlet = b.floorDevice(0, 'outlet', ['power-in']);
    const model = b.build();
    const device = (id: string) => Object.values(model.floors)[0]!.data.devices[id]!;
    const [front, back] = device(patch.id).ports;
    expect(registry.linkedPorts(device(patch.id), front!.id)).toEqual(new Set([back!.id]));
    expect(registry.linkedPorts(device(outlet.id), outlet.port('power-in'))).toBeNull();
  });
});
