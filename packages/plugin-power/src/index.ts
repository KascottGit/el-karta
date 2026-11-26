import type { DeviceTypeDef, DomainPlugin, PhotoHint, PortDef } from '@el-karta/core';
import { z } from 'zod';

export const POWER_DOMAIN = 'power';

/** The types photos can detect (M11); M5 adds panels, breakers and the rest. */
export const POWER_TYPES = ['outlet', 'switch', 'wall_light', 'ceiling_light'] as const;
export type PowerType = (typeof POWER_TYPES)[number];

export const SWITCH_VARIANTS = ['single', 'double', 'dimmer'] as const;

/**
 * Props per type. Every field is optional: what nobody has seen or entered stays unknown rather
 * than defaulting to a guess (principle 9). An outlet's number of sockets is `Device.count`.
 */
export const PowerProps = {
  outlet: z.object({ earthed: z.boolean().optional(), outdoor: z.boolean().optional() }).strict(),
  switch: z.object({ variant: z.enum(SWITCH_VARIANTS).optional() }).strict(),
  wall_light: z.object({}).strict(),
  ceiling_light: z.object({}).strict(),
} as const satisfies Record<PowerType, z.ZodType>;

/** Port kinds as the synthetic generator and M5's `circuit` and `control` connections use them. */
export const POWER_PORTS = {
  powerIn: 'power-in',
  controlOut: 'control-out',
  controlIn: 'control-in',
} as const;

const ports = (...kinds: string[]): PortDef[] => kinds.map((kind) => ({ kind }));

/** Typical Swedish mounting heights in metres, used when a device is placed without measuring. */
export const POWER_DEFAULT_HEIGHTS = { outlet: 0.25, switch: 1.05, wall_light: 1.9 } as const;

const deviceType = (
  type: PowerType,
  placements: DeviceTypeDef['placements'],
  defaultPorts: PortDef[],
  defaultHeight?: number,
): DeviceTypeDef => ({
  type,
  labelKey: `devices.types.${POWER_DOMAIN}.${type}`,
  icon: type,
  placements,
  ...(defaultHeight === undefined ? {} : { defaultHeight }),
  defaultPorts,
  props: PowerProps[type],
});

export const powerDeviceTypes: readonly DeviceTypeDef[] = [
  deviceType('outlet', ['wall'], ports(POWER_PORTS.powerIn), POWER_DEFAULT_HEIGHTS.outlet),
  deviceType(
    'switch',
    ['wall'],
    ports(POWER_PORTS.powerIn, POWER_PORTS.controlOut),
    POWER_DEFAULT_HEIGHTS.switch,
  ),
  deviceType(
    'wall_light',
    ['wall'],
    ports(POWER_PORTS.powerIn, POWER_PORTS.controlIn),
    POWER_DEFAULT_HEIGHTS.wall_light,
  ),
  deviceType('ceiling_light', ['ceiling'], ports(POWER_PORTS.powerIn, POWER_PORTS.controlIn)),
];

const photoHints: readonly PhotoHint[] = [
  {
    type: 'outlet',
    description:
      'Wall socket outlet (Schuko type F in Sweden), usually low on the wall or above a kitchen counter. Count the sockets in one frame.',
    countable: true,
  },
  {
    type: 'switch',
    description:
      'Light switch on the wall, usually near a door at about hand height. A double switch has two rockers; a dimmer has a knob or a single large rocker marked as such.',
    visibleProps: { variant: SWITCH_VARIANTS },
  },
  {
    type: 'wall_light',
    description: 'Light fitting mounted on a wall (sconce, under-cabinet light counts too).',
  },
  {
    type: 'ceiling_light',
    description:
      'Light fitting on or hanging from the ceiling, including a bare ceiling outlet (DCL) or hook.',
  },
];

/** Outlets, switches and lights (M11 subset of M5's power plugin). */
export const powerPlugin: DomainPlugin = {
  id: POWER_DOMAIN,
  nameKey: 'power.name',
  deviceTypes: powerDeviceTypes,
  connectionKinds: [],
  traceKinds: [],
  aiHints: { photo: photoHints },
};
