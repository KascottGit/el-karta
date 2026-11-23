import type { View3dDevHook } from './dev-hook-types';

export function setView3dDevHook(hook: View3dDevHook | undefined): void {
  if (!import.meta.env.DEV) return;
  if (hook) window.__view3d = hook;
  else delete window.__view3d;
}
