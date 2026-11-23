import type { FloorData, Id, Vec3 } from '@el-karta/core';
import { useFrame, useThree } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Group,
} from 'three';
import type { SelectionItem } from '@/features/floorplan/canvas/selection';
import { useEditorStore } from '@/features/floorplan/editor-store';
import { materials } from '../materials';
import { toThree } from '../meshes/merged';
import type { SceneRegistry } from '../scene-registry';
import { gizmoHandles, gizmoTarget, HANDLE_PX, type GizmoHandle } from './handles';
import { useGizmoStore } from './preview-store';
import { pixelSize } from './screen';

const NO_SELECTION: readonly SelectionItem[] = [];

/** Unit-sized parts, scaled per frame to their size in pixels; an arrow points along +y. */
let parts:
  | { shaft: BufferGeometry; head: BufferGeometry; sphere: BufferGeometry; cube: BufferGeometry }
  | undefined;
const geometries = () =>
  (parts ??= {
    shaft: new CylinderGeometry(0.05, 0.05, 0.6, 12),
    head: new ConeGeometry(0.16, 0.2, 16),
    sphere: new SphereGeometry(0.5, 16, 12),
    cube: new BoxGeometry(1, 1, 1),
  });

const Y = new Vector3(0, 1, 0);
const turnTo = (dir: Vec3) =>
  new Quaternion().setFromUnitVectors(Y, new Vector3(...toThree(dir)).normalize());

function HandleMesh({ handle, active }: { handle: GizmoHandle; active: boolean }) {
  const g = geometries();
  const { gizmo, gizmoActive } = materials();
  const material = active ? gizmoActive : gizmo;
  const quaternion = useMemo(
    () => (handle.constraint.kind === 'axis' ? turnTo(handle.constraint.dir) : new Quaternion()),
    [handle.constraint],
  );
  // Shared geometry and materials; R3F would otherwise dispose them when a handle unmounts.
  const part = (geometry: BufferGeometry, y = 0, flip = false) => (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, y, 0]}
      rotation={[flip ? Math.PI : 0, 0, 0]}
      renderOrder={2}
      dispose={null}
    />
  );
  return (
    <group
      position={toThree(handle.at)}
      quaternion={quaternion}
      userData={{ px: HANDLE_PX[handle.shape] }}
    >
      {handle.shape === 'arrow' ? (
        <>
          {part(g.shaft)}
          {part(g.head, 0.4)}
          {part(g.head, -0.4, true)}
        </>
      ) : (
        part(handle.shape === 'sphere' ? g.sphere : g.cube)
      )}
    </group>
  );
}

/**
 * The handles of the selected wall or opening on the editor's floor (ADR 0009), drawn from the
 * data the floor is drawn from, so they follow a drag's preview. Each keeps its size on screen.
 */
export const Gizmo = memo(function Gizmo({
  floorId,
  data,
  registry,
}: {
  floorId: Id;
  data: FloorData;
  registry: SceneRegistry;
}) {
  const selection = useEditorStore((s) => (s.floorId === floorId ? s.selection : NO_SELECTION));
  const target = useMemo(() => gizmoTarget(selection), [selection]);
  const handles = useMemo(() => (target ? gizmoHandles(data, target) : []), [data, target]);
  const active = useGizmoStore((s) => s.active);
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    if (!target || handles.length === 0) return;
    const entry = { floorId, target, handles };
    registry.showGizmo(entry);
    invalidate();
    return () => {
      registry.hideGizmo(entry);
      invalidate();
    };
  }, [registry, floorId, target, handles, invalidate]);

  const world = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const child of group.current?.children ?? []) {
      const px: unknown = child.userData['px'];
      if (typeof px !== 'number') continue;
      child.getWorldPosition(world);
      child.scale.setScalar(px * pixelSize(camera, size, world));
    }
  });

  if (handles.length === 0) return null;
  return (
    <group ref={group}>
      {handles.map((h) => (
        <HandleMesh key={h.name} handle={h} active={h.name === active} />
      ))}
    </group>
  );
});
