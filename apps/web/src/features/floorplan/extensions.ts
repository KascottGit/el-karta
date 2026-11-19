import { baseExtension } from './canvas/base-extension';
import type { EditorExtension } from './canvas/extension';

/** Every feature folder that adds tools, actions, panels or canvas content registers here, one line each. */
export const extensions: readonly EditorExtension[] = [baseExtension];
