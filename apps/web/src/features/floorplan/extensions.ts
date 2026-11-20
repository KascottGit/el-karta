import { areasExtension } from './areas/extension';
import { backgroundExtension } from './background/extension';
import { baseExtension } from './canvas/base-extension';
import type { EditorExtension } from './canvas/extension';
import { devExtension } from './dev/extension';
import { gridExtension } from './grid/extension';
import { openingsExtension } from './openings/extension';
import { wallsExtension } from './walls/extension';

/** Every feature folder that adds tools, actions, handles, panels or canvas content, one line each. */
export const extensions: readonly EditorExtension[] = [
  baseExtension,
  areasExtension,
  wallsExtension,
  openingsExtension,
  backgroundExtension,
  gridExtension,
  ...(import.meta.env.DEV ? [devExtension] : []),
];
