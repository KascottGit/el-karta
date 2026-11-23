import { DoubleSide, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { canvasColors } from '@/features/floorplan/canvas/theme';

const colors = {
  wall: '#f8fafc',
  slab: '#cbd5e1',
  background: '#f1f5f9',
} as const;

export const view3dBackground = colors.background;

let shared:
  | {
      wall: MeshLambertMaterial;
      slab: MeshLambertMaterial;
      device: MeshLambertMaterial;
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
