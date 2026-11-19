import { areasExtension } from './areas/extension';
import { baseExtension } from './canvas/base-extension';
import type { EditorExtension } from './canvas/extension';
import { devExtension } from './dev/extension';
import { wallsExtension } from './walls/extension';

/** Every feature folder that adds tools, actions, handles, panels or canvas content, one line each. */
export const extensions: readonly EditorExtension[] = [
  baseExtension,
  areasExtension,
  wallsExtension,
  ...(import.meta.env.DEV ? [devExtension] : []),
];
