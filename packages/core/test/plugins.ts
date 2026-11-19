import { z } from 'zod';
import { CONTAINS, type DomainPlugin } from '../src/index.ts';

/** Minimal stand-ins for the real domain plugins (M5, M14), enough to exercise the core. */
export const testPower: DomainPlugin = {
  id: 'power',
  nameKey: 'power',
  deviceTypes: [
    {
      type: 'main_panel',
      labelKey: 'p',
      icon: 'p',
      placements: ['wall', 'floor'],
      defaultPorts: [{ kind: 'power-in' }],
      props: z.object({}),
    },
    {
      type: 'sub_panel',
      labelKey: 'p',
      icon: 'p',
      placements: ['wall', 'floor'],
      defaultPorts: [{ kind: 'power-in' }],
      props: z.object({}),
    },
    {
      type: 'breaker',
      labelKey: 'b',
      icon: 'b',
      placements: ['container'],
      defaultPorts: [{ kind: 'power-out' }],
      props: z.object({ rating: z.number().positive() }).loose(),
    },
    {
      type: 'outlet',
      labelKey: 'o',
      icon: 'o',
      placements: ['wall', 'floor'],
      defaultPorts: [{ kind: 'power-in' }],
      props: z.object({}),
    },
    {
      type: 'switch',
      labelKey: 's',
      icon: 's',
      placements: ['wall', 'floor'],
      defaultPorts: [{ kind: 'power-in' }, { kind: 'control-out' }],
      props: z.object({}),
    },
    {
      type: 'ceiling_light',
      labelKey: 'l',
      icon: 'l',
      placements: ['ceiling', 'floor'],
      defaultPorts: [{ kind: 'power-in' }, { kind: 'control-in' }],
      props: z.object({}),
    },
  ],
  connectionKinds: [
    { kind: 'circuit', labelKey: 'c', fromPortKinds: ['power-out'], toPortKinds: ['power-in'] },
    { kind: 'feeder', labelKey: 'f', fromPortKinds: ['power-out'], toPortKinds: ['power-in'] },
    { kind: 'control', labelKey: 'k', fromPortKinds: ['control-out'], toPortKinds: ['control-in'] },
  ],
  traceKinds: ['circuit', 'feeder', CONTAINS],
};

export const testNetwork: DomainPlugin = {
  id: 'network',
  nameKey: 'network',
  deviceTypes: [
    {
      type: 'switch',
      labelKey: 's',
      icon: 's',
      placements: ['floor'],
      defaultPorts: [],
      props: z.object({}),
    },
    {
      type: 'patch_panel',
      labelKey: 'pp',
      icon: 'pp',
      placements: ['floor'],
      defaultPorts: [],
      props: z.object({}),
      portLinks: (device) => {
        const front = device.ports.filter((p) => p.kind === 'front');
        const back = device.ports.filter((p) => p.kind === 'back');
        return front.map((p, i) => [p.id, back[i]!.id] as const);
      },
    },
    {
      type: 'wall_outlet',
      labelKey: 'w',
      icon: 'w',
      placements: ['floor'],
      defaultPorts: [],
      props: z.object({}),
    },
  ],
  connectionKinds: [
    {
      kind: 'ethernet',
      labelKey: 'e',
      fromPortKinds: ['lan', 'front', 'back'],
      toPortKinds: ['lan', 'front', 'back'],
    },
  ],
  traceKinds: ['ethernet'],
};
