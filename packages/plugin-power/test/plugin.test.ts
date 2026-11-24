import {
  createRegistry,
  generateProject,
  photoDetectables,
  validateModel,
  type DomainPlugin,
} from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { POWER_DOMAIN, POWER_TYPES, PowerProps, powerPlugin } from '../src/index.ts';

const registry = createRegistry([powerPlugin]);

describe('powerPlugin', () => {
  it('registers every type with its placement and i18n key', () => {
    expect(powerPlugin.deviceTypes.map((d) => d.type)).toEqual([...POWER_TYPES]);
    for (const type of POWER_TYPES) {
      expect(registry.deviceType(POWER_DOMAIN, type)?.labelKey).toBe(`devices.types.power.${type}`);
    }
    expect(registry.deviceType(POWER_DOMAIN, 'ceiling_light')?.placements).toEqual(['ceiling']);
    expect(registry.deviceType(POWER_DOMAIN, 'outlet')?.defaultHeight).toBe(0.25);
  });

  it('accepts unknown props as absent and refuses wrong or extra ones', () => {
    expect(PowerProps.outlet.safeParse({}).success).toBe(true);
    expect(PowerProps.outlet.safeParse({ earthed: true }).success).toBe(true);
    expect(PowerProps.outlet.safeParse({ earthed: 'yes' }).success).toBe(false);
    expect(PowerProps.switch.safeParse({ variant: 'dimmer' }).success).toBe(true);
    expect(PowerProps.switch.safeParse({ variant: 'triple' }).success).toBe(false);
    expect(PowerProps.ceiling_light.safeParse({ colour: 'white' }).success).toBe(false);
  });

  it('finds no prop or placement errors on the synthetic project', () => {
    const issues = validateModel(generateProject('medium'), registry).filter(
      (issue) =>
        issue.code === 'device.props-invalid' || issue.code === 'device.placement-not-allowed',
    );
    expect(issues).toEqual([]);
  });
});

describe('photoDetectables', () => {
  it('lists the power types with placement, default height and ports', () => {
    const found = photoDetectables(registry);
    expect(found.map((d) => d.type)).toEqual([...POWER_TYPES]);
    expect(found.find((d) => d.type === 'outlet')).toMatchObject({
      domain: POWER_DOMAIN,
      placement: 'wall',
      defaultHeight: 0.25,
      countable: true,
      ports: [{ kind: 'power-in', domain: POWER_DOMAIN }],
    });
    expect(found.find((d) => d.type === 'switch')?.visibleProps).toEqual({
      variant: ['single', 'double', 'dimmer'],
    });
    const ceiling = found.find((d) => d.type === 'ceiling_light')!;
    expect(ceiling.placement).toBe('ceiling');
    expect('defaultHeight' in ceiling).toBe(false);
  });

  it('skips hints for unknown types and floor-only types', () => {
    const odd: DomainPlugin = {
      id: 'furniture',
      nameKey: 'furniture',
      deviceTypes: [
        {
          type: 'desk',
          labelKey: 'desk',
          icon: 'desk',
          placements: ['floor'],
          defaultPorts: [],
          props: z.object({}),
        },
      ],
      connectionKinds: [],
      traceKinds: [],
      aiHints: {
        photo: [
          { type: 'desk', description: 'a desk' },
          { type: 'nope', description: 'missing' },
        ],
      },
    };
    expect(photoDetectables(createRegistry([odd]))).toEqual([]);
  });
});
