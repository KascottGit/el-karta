import type { Id, Vec3 } from '@el-karta/core';
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three';
import type { Box, RoomSlab } from '../geometry/types';

/** A plan point `(x, y, z)` in three.js coordinates `(x, z, y)` (see `../README.md`). */
export const toThree = (p: Vec3): [number, number, number] => [p.x, p.z, p.y];

export interface TriangleRange {
  start: number;
  count: number;
}

/**
 * The merged geometry of many items, with a triangle → item table for picking and each item's
 * triangles as one contiguous range for the selection highlight.
 */
export interface MergedMesh {
  geometry: BufferGeometry;
  ids: readonly Id[];
  /** For each triangle, the index of its item in `ids`. */
  itemOf: Uint32Array;
  ranges: ReadonlyMap<Id, TriangleRange>;
}

class MergedBuilder {
  readonly #positions: number[] = [];
  readonly #normals: number[] = [];
  readonly #index: number[] = [];
  readonly #ids: Id[] = [];
  readonly #itemOf: number[] = [];
  readonly #ranges = new Map<Id, TriangleRange>();
  #item = -1;
  #range: TriangleRange | null = null;

  /** Starts the triangles of one item; all of an item's triangles must be added together. */
  item(id: Id) {
    this.#item = this.#ids.length;
    this.#ids.push(id);
    this.#range = { start: this.#itemOf.length, count: 0 };
    this.#ranges.set(id, this.#range);
  }

  get vertices(): number {
    return this.#positions.length / 3;
  }

  /** A vertex at `(x, y, z)` with normal `(nx, ny, nz)`, both in three.js coordinates. */
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    this.#positions.push(x, y, z);
    this.#normals.push(nx, ny, nz);
    return this.#positions.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number) {
    this.#index.push(a, b, c);
    this.#itemOf.push(this.#item);
    if (this.#range) this.#range.count++;
  }

  build(): MergedMesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.#positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.#normals), 3));
    geometry.setIndex(this.#index);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return {
      geometry,
      ids: this.#ids,
      itemOf: Uint32Array.from(this.#itemOf),
      ranges: this.#ranges,
    };
  }
}

type Triple = readonly [number, number, number];

/**
 * The six faces of a box centred on the origin with half-size 1: each face's outward normal and
 * its corners, counter-clockwise from outside in plan coordinates.
 */
const FACES: readonly { normal: Triple; corners: readonly Triple[] }[] = [0, 1, 2].flatMap((axis) =>
  [1, -1].map((sign) => {
    const at = (u: number, v: number): Triple => {
      const p = [0, 0, 0];
      p[axis] = sign;
      p[(axis + 1) % 3] = u;
      p[(axis + 2) % 3] = v;
      return [p[0]!, p[1]!, p[2]!];
    };
    const quad = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
    const normal: Triple = [axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0];
    return { normal, corners: sign > 0 ? quad : quad.reverse() };
  }),
);

/**
 * Adds a box as six quads with their own vertices, so each face is lit flat. The faces are wound
 * counter-clockwise from outside in plan coordinates; `toThree` mirrors that, so the triangles
 * are emitted in reverse. Runs for every wall piece on every rebuild, including each pointer move
 * of a gizmo drag, so it allocates nothing per vertex.
 */
function addBox(b: MergedBuilder, { center, size, rotation }: Box) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  for (const { normal, corners } of FACES) {
    // Plan (x, y, z) is three.js (x, z, y).
    const nx = normal[0] * cos - normal[1] * sin;
    const ny = normal[0] * sin + normal[1] * cos;
    const v0 = b.vertices;
    for (const [sx, sy, sz] of corners) {
      const x = sx * hx;
      const y = sy * hy;
      b.vertex(
        center.x + x * cos - y * sin,
        center.z + sz * hz,
        center.y + x * sin + y * cos,
        nx,
        normal[2],
        ny,
      );
    }
    b.triangle(v0, v0 + 2, v0 + 1);
    b.triangle(v0, v0 + 3, v0 + 2);
  }
}

/**
 * Merges boxes, grouped by the item each belongs to. With `materialOf`, items are ordered by their
 * material index and the geometry gets one draw group per index, for a mesh with a material array.
 * All of an item's boxes must have the same material.
 */
export function mergeBoxes<T extends Box>(
  boxes: readonly T[],
  idOf: (box: T) => Id,
  materialOf?: (box: T) => number,
): MergedMesh {
  const byItem = new Map<Id, T[]>();
  for (const box of boxes) {
    const id = idOf(box);
    const list = byItem.get(id);
    if (list) list.push(box);
    else byItem.set(id, [box]);
  }
  const items = [...byItem];
  const material = ([, list]: (typeof items)[number]) => materialOf?.(list[0]!) ?? 0;
  if (materialOf) items.sort((p, q) => material(p) - material(q));
  const b = new MergedBuilder();
  for (const [id, list] of items) {
    b.item(id);
    for (const box of list) addBox(b, box);
  }
  const mesh = b.build();
  if (materialOf) {
    for (const item of items) {
      const range = mesh.ranges.get(item[0])!;
      const index = material(item);
      const last = mesh.geometry.groups.at(-1);
      if (last?.materialIndex === index) last.count += range.count * 3;
      else mesh.geometry.addGroup(range.start * 3, range.count * 3, index);
    }
  }
  return mesh;
}

/** Triangulates each room's outline at the floor's surface, facing up. */
export function mergeSlabs(slabs: readonly RoomSlab[]): MergedMesh {
  const b = new MergedBuilder();
  for (const { roomId, outline } of slabs) {
    const triangles = ShapeUtils.triangulateShape(
      outline.map((p) => new Vector2(p.x, p.y)),
      [],
    );
    b.item(roomId);
    const first = outline.map((p) => b.vertex(p.x, 0, p.y, 0, 1, 0));
    for (const [i = 0, j = 0, k = 0] of triangles) {
      const [p, q, r] = [outline[i], outline[j], outline[k]];
      if (!p || !q || !r) continue;
      // The y of the cross product in three.js space, where plan y is three.js z.
      const up = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) < 0;
      const [a, c] = [first[i] ?? 0, first[k] ?? 0];
      const mid = first[j] ?? 0;
      if (up) b.triangle(a, mid, c);
      else b.triangle(a, c, mid);
    }
  }
  return b.build();
}
