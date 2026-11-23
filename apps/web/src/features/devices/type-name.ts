import type { Device } from '@el-karta/core';
import i18n from '@/i18n';
import type { MessageKey } from '@/features/floorplan/canvas/extension';

/** The Swedish name of a device's type, from `devices.types.<domain>.<type>`, or a generic one. */
export function deviceTypeName(device: Pick<Device, 'domain' | 'type'>): string {
  // Domains and types are data; `devices.types.<domain>.<type>` is the convention for their names.
  const key = `devices.types.${device.domain}.${device.type}` as MessageKey;
  return i18n.t(key, { defaultValue: i18n.t('devices.types.generic') });
}
