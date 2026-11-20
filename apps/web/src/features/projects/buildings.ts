import type { Building, Model } from '@el-karta/core';

/** Buildings have no stored order, so they are listed by name in the UI language. */
export const buildingsInOrder = (model: Model, locale: string): Building[] =>
  Object.values(model.project.data.buildings).sort(
    (a, b) => a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id),
  );
