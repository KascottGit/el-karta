import { createRegistry } from '@el-karta/core';
import { furnishingPlugin } from '@el-karta/plugin-furnishing';
import { powerPlugin } from '@el-karta/plugin-power';

/** Every domain plugin the app knows, one line each. */
export const registry = createRegistry([powerPlugin, furnishingPlugin]);
