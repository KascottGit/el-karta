import type { Opening } from '@el-karta/core';
import { DoubleSide, MeshBasicMaterial, MeshLambertMaterial, type Material } from 'three';
import { canvasColors } from '@/features/floorplan/canvas/theme';

const colors = {
  wall: '#f8fafc',
  slab: '#cbd5e1',
  door: '#b08968',
  glass: '#7dd3fc',
  background: '#f1f5f9',
} as const;

export const view3dBackground = colors.background;

let shared:
  | {
      wall: MeshLambertMaterial;
      slab: MeshLambertMaterial;
      device: MeshLambertMaterial;
      opening: Readonly<Record<Opening['kind'], Material>>;
      highlight: MeshBasicMaterial;
    }
  | undefined;

/** Materials shared by every floor; created once and never disposed. */
export function materials() {
  shared ??= {
    wall: new MeshLambertMaterial({ color: colors.wall }),
    // Pushed back, so the bottoms of walls standing on the slab win the depth test.
    slab: new MeshLambertMaterial({
      color: colors.slab,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    // White, so each instance shows its own colour.
    device: new MeshLambertMaterial({ color: '#ffffff' }),
    opening: {
      door: new MeshLambertMaterial({ color: colors.door }),
      window: new MeshLambertMaterial({
        color: colors.glass,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
      // Not drawn, but raycast: three.js skips invisible materials when rendering and never when
      // raycasting, so a tap in a passage's gap picks it.
      passage: new MeshBasicMaterial({ visible: false }),
    },
    highlight: new MeshBasicMaterial({
      color: canvasColors.selected,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  };
  return shared;
}
