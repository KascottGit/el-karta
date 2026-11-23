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

  /** Starts the triangles of one item; all of an item's triangles must be added together. */
  item(id: Id) {
    this.#item = this.#ids.length;
    this.#ids.push(id);
    this.#ranges.set(id, { start: this.#itemOf.length, count: 0 });
  }

  vertex(p: readonly number[], n: readonly number[]): number {
    this.#positions.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
    this.#normals.push(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
    return this.#positions.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number) {
    this.#index.push(a, b, c);
    this.#itemOf.push(this.#item);
    const range = this.#ranges.get(this.#ids[this.#item] ?? '');
    if (range) range.count++;
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

const UNIT = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
] as const;
const QUAD = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

/**
 * Adds a box as six quads with their own vertices, so each face is lit flat. The faces are wound
 * counter-clockwise from outside in plan coordinates; `toThree` mirrors that, so the triangles
 * are emitted in reverse.
 */
function addBox(b: MergedBuilder, { center, size, rotation }: Box) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const turn = (x: number, y: number, z: number): [number, number, number] => [
    x * cos - y * sin,
    x * sin + y * cos,
    z,
  ];
  const half = [size.x / 2, size.y / 2, size.z / 2];
  for (let axis = 0; axis < 3; axis++) {
    const n = UNIT[axis]!;
    const t1 = UNIT[(axis + 1) % 3]!;
    const t2 = UNIT[(axis + 2) % 3]!;
    for (const sign of [1, -1]) {
      const corners = sign > 0 ? QUAD : [...QUAD].reverse();
      const [nx, ny, nz] = turn(n[0] * sign, n[1] * sign, n[2] * sign);
      const normal = [nx, nz, ny];
      const verts = corners.map(([u, v]) => {
        const local = [0, 1, 2].map(
          (k) => (n[k]! * sign + u * t1[k]! + v * t2[k]!) * (half[k] ?? 0),
        );
        const [x, y, z] = turn(local[0]!, local[1]!, local[2]!);
        return b.vertex(toThree({ x: center.x + x, y: center.y + y, z: center.z + z }), normal);
      });
      const [v0 = 0, v1 = 0, v2 = 0, v3 = 0] = verts;
      b.triangle(v0, v2, v1);
      b.triangle(v0, v3, v2);
    }
  }
}

/** Merges boxes, grouped by the item each belongs to. */
export function mergeBoxes<T extends Box>(boxes: readonly T[], idOf: (box: T) => Id): MergedMesh {
  const byItem = new Map<Id, T[]>();
  for (const box of boxes) {
    const id = idOf(box);
    const list = byItem.get(id);
    if (list) list.push(box);
    else byItem.set(id, [box]);
  }
  const b = new MergedBuilder();
  for (const [id, list] of byItem) {
    b.item(id);
    for (const box of list) addBox(b, box);
  }
  return b.build();
}

const UP = [0, 1, 0];

/** Triangulates each room's outline at the floor's surface, facing up. */
export function mergeSlabs(slabs: readonly RoomSlab[]): MergedMesh {
  const b = new MergedBuilder();
  for (const { roomId, outline } of slabs) {
    const triangles = ShapeUtils.triangulateShape(
      outline.map((p) => new Vector2(p.x, p.y)),
      [],
    );
    b.item(roomId);
    const first = outline.map((p) => b.vertex(toThree({ ...p, z: 0 }), UP));
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
