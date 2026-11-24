import type { PhotoDetectableInput } from '@el-karta/ai-passes';
import { createRegistry, photoDetectables } from '@el-karta/core';
import { furnishingPlugin } from '@el-karta/plugin-furnishing';
import { powerPlugin } from '@el-karta/plugin-power';

/**
 * What the app sends as `PhotoInput.detectable`, built the same way from the same plugins. A web
 * test (`floorplan/dev/floor-export.test.ts`) fails if this plugin list and the app's differ.
 */
export const photoDetectable: readonly PhotoDetectableInput[] = photoDetectables(
  createRegistry([powerPlugin, furnishingPlugin]),
);
