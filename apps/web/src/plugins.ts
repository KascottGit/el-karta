import { createRegistry } from '@el-karta/core';
import { furnishingPlugin } from '@el-karta/plugin-furnishing';

/** Every domain plugin the app knows, one line each. */
export const registry = createRegistry([furnishingPlugin]);
