import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Box } from '../geometry/types';
import { mergeBoxes, mergeSlabs, toThree, type MergedMesh } from './merged';

const box = (id: string, extra: Partial<Box> = {}): Box & { id: string } => ({
  id,
  center: { x: 2, y: 1, z: 1.25 },
  size: { x: 4, y: 0.2, z: 2.5 },
  rotation: 0,
  ...extra,
});

/** Each triangle's corners, its normal from the winding, and its stored vertex normal. */
function triangles(mesh: MergedMesh) {
  const index = mesh.geometry.getIndex()!;
  const position = mesh.geometry.getAttribute('position');
  const normal = mesh.geometry.getAttribute('normal');
  const out = [];
  for (let t = 0; t < index.count / 3; t++) {
    const [a, b, c] = [0, 1, 2].map((k) =>
      new Vector3().fromBufferAttribute(position, index.getX(t * 3 + k)),
    ) as [Vector3, Vector3, Vector3];
    const wound = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    const stored = new Vector3().fromBufferAttribute(normal, index.getX(t * 3));
    out.push({ a, b, c, wound, stored });
  }
  return out;
}

describe('toThree', () => {
  it('maps plan (x, y, z) to three.js (x, z, y)', () => {
    expect(toThree({ x: 1, y: 2, z: 3 })).toEqual([1, 3, 2]);
  });
});

describe('mergeBoxes', () => {
  it('winds every face outwards in three.js space, matching its normal', () => {
    for (const rotation of [0, 0.7, -2]) {
      const mesh = mergeBoxes([box('w', { rotation })], (b) => b.id);
      const tris = triangles(mesh);
      expect(tris).toHaveLength(12);
      const center = new Vector3(...toThree(box('w').center));
      for (const { a, wound, stored } of tris) {
        expect(wound.dot(stored)).toBeCloseTo(1);
        // Outwards: the normal points away from the box centre.
        expect(new Vector3().subVectors(a, center).dot(wound)).toBeGreaterThan(0);
      }
    }
  });

  it('places a turned box in three.js coordinates with plan y as three.js z', () => {
    const mesh = mergeBoxes([box('w', { rotation: Math.PI / 2 })], (b) => b.id);
    mesh.geometry.computeBoundingBox();
    const { min, max } = mesh.geometry.boundingBox!;
    // Turned a quarter towards plan +y, its 4 m length runs along plan y, i.e. three.js z.
    expect([min.x, max.x]).toEqual([expect.closeTo(1.9), expect.closeTo(2.1)]);
    expect([min.z, max.z]).toEqual([expect.closeTo(-1), expect.closeTo(3)]);
    expect([min.y, max.y]).toEqual([expect.closeTo(0), expect.closeTo(2.5)]);
  });

  it('groups each item’s triangles into one range and maps triangles back to it', () => {
    const boxes = [box('a'), box('b'), box('a', { center: { x: 9, y: 9, z: 1 } })];
    const mesh = mergeBoxes(boxes, (b) => b.id);
    expect(mesh.ranges.get('a')).toEqual({ start: 0, count: 24 });
    expect(mesh.ranges.get('b')).toEqual({ start: 24, count: 12 });
    expect(mesh.ids[mesh.itemOf[23]!]).toBe('a');
    expect(mesh.ids[mesh.itemOf[24]!]).toBe('b');
    expect(mesh.itemOf).toHaveLength(36);
  });
  it('orders items by material and gives each material one draw group', () => {
    const boxes = [
      { ...box('a'), material: 1 },
      { ...box('b'), material: 0 },
      { ...box('c'), material: 1 },
      { ...box('b', { center: { x: 9, y: 9, z: 1 } }), material: 0 },
    ];
    const mesh = mergeBoxes(
      boxes,
      (b) => b.id,
      (b) => b.material,
    );
    expect(mesh.ids).toEqual(['b', 'a', 'c']);
    expect(mesh.geometry.groups).toEqual([
      { start: 0, count: 72, materialIndex: 0 },
      { start: 72, count: 72, materialIndex: 1 },
    ]);
    expect(mergeBoxes(boxes, (b) => b.id).geometry.groups).toEqual([]);
  });
});

describe('mergeSlabs', () => {
  const L = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 4 },
    { x: 0, y: 4 },
  ];

  it('triangulates each outline facing up, in either winding, covering its area', () => {
    for (const outline of [L, [...L].reverse()]) {
      const mesh = mergeSlabs([{ roomId: 'r', outline }]);
      const tris = triangles(mesh);
      expect(mesh.ranges.get('r')).toEqual({ start: 0, count: tris.length });
      let area = 0;
      for (const { a, b, c, wound } of tris) {
        expect(wound.y).toBeCloseTo(1);
        expect(a.y).toBe(0);
        area += new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).length() / 2;
      }
      expect(area).toBeCloseTo(12);
    }
  });
});
