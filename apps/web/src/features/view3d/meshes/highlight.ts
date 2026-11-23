import { BufferAttribute, BufferGeometry, Matrix4 } from 'three';
import { selectedIds, type SelectionItem } from '@/features/floorplan/canvas/selection';
import { instanceTemplate } from './devices';
import type { FloorMeshes } from './floor-meshes';
import type { MergedMesh } from './merged';

/** How far the highlight stands out of the item's surfaces, in metres, so it never z-fights. */
export const HIGHLIGHT_INFLATE = 0.02;

export interface Highlight {
  geometry: BufferGeometry;
  /** The selected items it draws: those drawn on this floor in 3D. */
  items: SelectionItem[];
}

class Collector {
  readonly positions: number[] = [];
  readonly normals: number[] = [];

  /** Adds a vertex pushed out along its normal. */
  vertex(p: ArrayLike<number>, pi: number, n: ArrayLike<number>, ni: number) {
    const nx = n[ni] ?? 0;
    const ny = n[ni + 1] ?? 0;
    const nz = n[ni + 2] ?? 0;
    this.positions.push(
      (p[pi] ?? 0) + nx * HIGHLIGHT_INFLATE,
      (p[pi + 1] ?? 0) + ny * HIGHLIGHT_INFLATE,
      (p[pi + 2] ?? 0) + nz * HIGHLIGHT_INFLATE,
    );
    this.normals.push(nx, ny, nz);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    return g;
  }
}

function addMerged(out: Collector, mesh: MergedMesh, ids: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const index = mesh.geometry.getIndex()?.array;
  const position = mesh.geometry.getAttribute('position').array;
  const normal = mesh.geometry.getAttribute('normal').array;
  if (!index) return found;
  for (const id of ids) {
    const range = mesh.ranges.get(id);
    if (!range) continue;
    found.push(id);
    for (let i = range.start * 3; i < (range.start + range.count) * 3; i++) {
      const v = (index[i] ?? 0) * 3;
      out.vertex(position, v, normal, v);
    }
  }
  return found;
}

function addInstances(out: Collector, meshes: FloorMeshes, ids: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const m = new Matrix4();
  for (const group of meshes.devices) {
    group.ids.forEach((id, i) => {
      if (!ids.has(id)) return;
      found.push(id);
      const g = instanceTemplate(group.shape).geometry.toNonIndexed();
      g.applyMatrix4(m.fromArray(group.matrices, i * 16));
      const position = g.getAttribute('position').array;
      const normal = g.getAttribute('normal').array;
      for (let v = 0; v < position.length; v += 3) out.vertex(position, v, normal, v);
      g.dispose();
    });
  }
  return found;
}

/**
 * The selected walls, rooms and devices of one floor as a separate geometry, standing slightly out
 * of their surfaces. Built from the floor's meshes without changing them, so selecting never
 * rebuilds the merged geometry. Null when none of the selection is drawn on this floor.
 */
export function highlightGeometry(
  meshes: FloorMeshes,
  selection: readonly SelectionItem[],
): Highlight | null {
  if (selection.length === 0) return null;
  const out = new Collector();
  const items: SelectionItem[] = [
    ...addMerged(out, meshes.walls, selectedIds(selection, 'walls')).map((id) => ({
      collection: 'walls' as const,
      id,
    })),
    ...addMerged(out, meshes.slabs, selectedIds(selection, 'rooms')).map((id) => ({
      collection: 'rooms' as const,
      id,
    })),
    ...addInstances(out, meshes, selectedIds(selection, 'devices')).map((id) => ({
      collection: 'devices' as const,
      id,
    })),
  ];
  return items.length > 0 ? { geometry: out.geometry(), items } : null;
}
