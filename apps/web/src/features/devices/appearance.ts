import type { Device } from '@el-karta/core';

export type MarkerShape = 'circle' | 'square' | 'diamond' | 'triangle';

/** How a device is drawn in 2D and 3D until its domain brings its own icons. */
export interface DeviceAppearance {
  shape: MarkerShape;
  color: string;
}

const FALLBACK: DeviceAppearance = { shape: 'circle', color: '#64748b' };

const byDomain: Readonly<Record<string, DeviceAppearance>> = {
  power: { shape: 'circle', color: '#ea580c' },
  furnishing: { shape: 'square', color: '#a16207' },
};

/** Keyed `domain:type`; overrides the domain's appearance. */
const byType: Readonly<Record<string, DeviceAppearance>> = {
  'power:main_panel': { shape: 'square', color: '#b91c1c' },
  'power:sub_panel': { shape: 'square', color: '#dc2626' },
  'power:outlet': { shape: 'circle', color: '#ea580c' },
  'power:switch': { shape: 'diamond', color: '#0891b2' },
  'power:ceiling_light': { shape: 'triangle', color: '#ca8a04' },
  'power:wall_light': { shape: 'triangle', color: '#d97706' },
};

export function deviceAppearance(device: Pick<Device, 'domain' | 'type'>): DeviceAppearance {
  return byType[`${device.domain}:${device.type}`] ?? byDomain[device.domain] ?? FALLBACK;
}

/**
 * Devices inside a container (breakers in a panel) are shown by the container view, not as their
 * own marker on the plan or in 3D.
 */
export const hasOwnMarker = (device: Pick<Device, 'placement'>): boolean =>
  device.placement.kind !== 'container';
