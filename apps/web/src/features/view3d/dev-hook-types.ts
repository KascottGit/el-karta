import type { FloorCollection, Id } from '@el-karta/core';

export interface View3dItem {
  floorId: Id;
  collection: FloorCollection;
  id: Id;
}

/**
 * Dev-only hook the e2e tests use to find where an item is drawn in the 3D view, since a WebGL
 * canvas has no DOM nodes to locate. The 3D view sets it while mounted in a dev build.
 */
export interface View3dDevHook {
  /** A point on the item in CSS pixels relative to the 3D canvas, or null when it is not visible. */
  screenPosition: (item: View3dItem) => { x: number; y: number } | null;
  /** How many times each floor's merged geometry was built, keyed by floor id. */
  builds: () => Readonly<Record<Id, number>>;
}

declare global {
  interface Window {
    __view3d?: View3dDevHook;
  }
}
