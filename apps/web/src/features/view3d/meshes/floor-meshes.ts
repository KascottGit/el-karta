import { OPENING_KINDS, type FloorData, type FloorRecord, type Id } from '@el-karta/core';
import { deviceIssues } from '@/features/devices/device-issues';
import { issueColors } from '@/features/floorplan/canvas/theme';
import { worstSeverity } from '@/features/floorplan/validation/severity';
import { buildFloorGeometry } from '../geometry/floor';
import type { FloorGeometry } from '../geometry/types';
import { deviceInstances, type DeviceInstances } from './devices';
import { mergeBoxes, mergeSlabs, type MergedMesh } from './merged';

/** Everything the 3D view renders for one floor, in floor-local three.js coordinates. */
export interface FloorMeshes {
  floorId: Id;
  geometry: FloorGeometry;
  walls: MergedMesh;
  /** Door leaves, window panes and passage volumes, one draw group per kind (`OPENING_KINDS`). */
  openings: MergedMesh;
  slabs: MergedMesh;
  devices: readonly DeviceInstances[];
}

const cache = new WeakMap<FloorData, FloorMeshes>();
const builds = new Map<Id, number>();

function build(floor: FloorRecord): FloorMeshes {
  const geometry = buildFloorGeometry(floor.data);
  const issues = deviceIssues(floor);
  builds.set(floor.id, (builds.get(floor.id) ?? 0) + 1);
  return {
    floorId: floor.id,
    geometry,
    walls: mergeBoxes(geometry.walls, (piece) => piece.wallId),
    openings: mergeBoxes(
      geometry.openings,
      (piece) => piece.openingId,
      (piece) => OPENING_KINDS.indexOf(piece.kind),
    ),
    slabs: mergeSlabs(geometry.slabs),
    devices: deviceInstances(geometry.devices, (t) => {
      const severity = worstSeverity(issues.get(t.deviceId));
      return severity ? issueColors[severity] : t.color;
    }),
  };
}

/**
 * A floor's meshes, built only when its data changes. Immer keeps the data of unchanged floors
 * identical, so an edit rebuilds only the floor it touched, and nothing else (the selection, the
 * visible floors) ever rebuilds them.
 */
export function floorMeshes(floor: FloorRecord): FloorMeshes {
  let meshes = cache.get(floor.data);
  if (!meshes) {
    meshes = build(floor);
    cache.set(floor.data, meshes);
  }
  return meshes;
}

/** How many times each floor's meshes have been built. */
export const buildCounts = (): Readonly<Record<Id, number>> => Object.fromEntries(builds);

export function disposeFloorMeshes(meshes: FloorMeshes) {
  meshes.walls.geometry.dispose();
  meshes.openings.geometry.dispose();
  meshes.slabs.geometry.dispose();
}
