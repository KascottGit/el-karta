import type { DomainPlugin } from '@el-karta/core';

export const FURNISHING_DOMAIN = 'furnishing';

export const furnishingPlugin: DomainPlugin = {
  id: FURNISHING_DOMAIN,
  nameKey: 'furnishing.name',
  deviceTypes: [],
  connectionKinds: [],
  traceKinds: [],
};
