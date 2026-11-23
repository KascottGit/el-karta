import type { Id } from '@el-karta/core';
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Matrix4,
  OctahedronGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { MarkerShape } from '@/features/devices/appearance';
import type { DeviceTransform } from '../geometry/types';
import { toThree } from './merged';

/** Furniture is drawn as a unit box scaled to its size; markers by their shape. */
export type InstanceShape = MarkerShape | 'box';

export interface DeviceInstances {
  shape: InstanceShape;
  ids: readonly Id[];
  /** Column-major 4×4 matrices, one per instance, in floor-local three.js coordinates. */
  matrices: Float32Array;
  /** RGB per instance. */
  colors: Float32Array;
}

/** Marker sizes in metres; each template faces +y (three.js up), the axis turned to `facing`. */
const MARKER = 0.16;
const MARKER_DEPTH = 0.05;

interface Template {
  geometry: BufferGeometry;
  /** Extent along +y, so a marker sits on the surface it faces out of. */
  depth: number;
}

let templates: Readonly<Record<InstanceShape, Template>> | undefined;

/** The shared template geometry of each shape; created once and never disposed. */
export function instanceTemplate(shape: InstanceShape): Template {
  templates ??= {
    box: { geometry: new BoxGeometry(1, 1, 1), depth: 0 },
    circle: {
      geometry: new CylinderGeometry(MARKER / 2, MARKER / 2, MARKER_DEPTH, 16),
      depth: MARKER_DEPTH,
    },
    square: { geometry: new BoxGeometry(MARKER, MARKER_DEPTH, MARKER), depth: MARKER_DEPTH },
    diamond: { geometry: new OctahedronGeometry(MARKER / 2), depth: MARKER },
    triangle: { geometry: new ConeGeometry(MARKER / 2, MARKER, 3), depth: MARKER },
  };
  return templates[shape];
}

const Y = new Vector3(0, 1, 0);

function instanceMatrix(t: DeviceTransform, out: Matrix4): Matrix4 {
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  if (t.kind === 'box') {
    position.set(...toThree(t.center));
    // three.js turns about its y axis the other way round (toThree mirrors the plan).
    rotation.setFromAxisAngle(Y, -t.rotation);
    scale.set(t.size.x, t.size.z, t.size.y);
  } else {
    const facing = new Vector3(...toThree(t.facing)).normalize();
    const depth = instanceTemplate(t.shape).depth;
    position.set(...toThree(t.position)).addScaledVector(facing, depth / 2);
    rotation.setFromUnitVectors(Y, facing);
  }
  return out.compose(position, rotation, scale);
}

/** One group of instances per shape, coloured by `colorOf`. */
export function deviceInstances(
  transforms: readonly DeviceTransform[],
  colorOf: (t: DeviceTransform) => string,
): DeviceInstances[] {
  const byShape = new Map<InstanceShape, DeviceTransform[]>();
  for (const t of transforms) {
    const shape = t.kind === 'box' ? 'box' : t.shape;
    const list = byShape.get(shape);
    if (list) list.push(t);
    else byShape.set(shape, [t]);
  }
  const m = new Matrix4();
  const c = new Color();
  return [...byShape].map(([shape, list]) => {
    const matrices = new Float32Array(list.length * 16);
    const colors = new Float32Array(list.length * 3);
    list.forEach((t, i) => {
      instanceMatrix(t, m).toArray(matrices, i * 16);
      c.set(colorOf(t)).toArray(colors, i * 3);
    });
    return { shape, ids: list.map((t) => t.deviceId), matrices, colors };
  });
}
