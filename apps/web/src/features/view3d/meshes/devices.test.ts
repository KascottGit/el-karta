import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { DeviceBox, DeviceMarker } from '../geometry/types';
import { deviceInstances, instanceTemplate } from './devices';

const furniture: DeviceBox = {
  kind: 'box',
  deviceId: 'desk',
  center: { x: 5, y: 3, z: 0.375 },
  size: { x: 1.6, y: 0.8, z: 0.75 },
  rotation: Math.PI / 2,
  color: '#a16207',
  flagged: false,
};

const outlet: DeviceMarker = {
  kind: 'marker',
  deviceId: 'outlet',
  position: { x: 1, y: 0.1, z: 0.3 },
  facing: { x: 0, y: 1, z: 0 },
  shape: 'circle',
  color: '#ea580c',
  flagged: false,
};

const matrixOf = (matrices: Float32Array, i: number) => new Matrix4().fromArray(matrices, i * 16);

describe('deviceInstances', () => {
  it('groups devices by shape with their ids and colours', () => {
    const groups = deviceInstances([furniture, outlet, { ...outlet, deviceId: 'o2' }], (t) =>
      t.deviceId === 'o2' ? '#ff0000' : t.color,
    );
    expect(groups.map((g) => [g.shape, g.ids])).toEqual([
      ['box', ['desk']],
      ['circle', ['outlet', 'o2']],
    ]);
    const circles = groups[1]!;
    expect([...circles.colors.slice(3, 6)]).toEqual([1, 0, 0]);
  });

  it('turns furniture the same way as the plan: its width along plan y after a quarter turn', () => {
    const [box] = deviceInstances([furniture], (t) => t.color);
    const m = matrixOf(box!.matrices, 0);
    // The unit box's +x end (its width) and +z end (its depth) in three.js coordinates.
    const end = new Vector3(0.5, 0, 0).applyMatrix4(m);
    const side = new Vector3(0, 0, 0.5).applyMatrix4(m);
    const top = new Vector3(0, 0.5, 0).applyMatrix4(m);
    // Plan (5, 3 + 0.8) → three.js (5, _, 3.8): plan +x turned towards plan +y.
    expect([end.x, end.z]).toEqual([expect.closeTo(5), expect.closeTo(3.8)]);
    expect([side.x, side.z]).toEqual([expect.closeTo(4.6), expect.closeTo(3)]);
    expect(top.y).toBeCloseTo(0.75);
  });

  it('stands a marker on the surface it faces out of', () => {
    const [circle] = deviceInstances([outlet], (t) => t.color);
    const m = matrixOf(circle!.matrices, 0);
    const center = new Vector3().applyMatrix4(m);
    const front = new Vector3(0, instanceTemplate('circle').depth / 2, 0).applyMatrix4(m);
    // Facing plan +y is three.js +z; the back of the marker touches the wall face at plan y 0.1.
    expect([center.x, center.y]).toEqual([expect.closeTo(1), expect.closeTo(0.3)]);
    expect(center.z).toBeCloseTo(0.1 + instanceTemplate('circle').depth / 2);
    expect(front.z - center.z).toBeCloseTo(instanceTemplate('circle').depth / 2);
  });
});
