import type { Id } from '@el-karta/core';
import { OrbitControls } from '@react-three/drei';
import { useThree, type RootState } from '@react-three/fiber';
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type RefObject,
} from 'react';
import { InstancedMesh, type Group } from 'three';
import type { SelectionItem } from '@/features/floorplan/canvas/selection';
import {
  createGestureController,
  type PointerInput,
  type PointerKind,
} from '@/features/floorplan/canvas/gestures';
import { editorStore, useEditorStore } from '@/features/floorplan/editor-store';
import { useModelStore } from '@/model/store';
import { fitCamera } from './camera';
import { setView3dDevHook } from './dev-hook';
import { visibleFloors, useView3dStore } from './floor-visibility';
import { stackedBounds } from './geometry/bounds';
import { floorBases } from './geometry/stacking';
import { materials } from './materials';
import {
  buildCounts,
  disposeFloorMeshes,
  floorMeshes,
  type FloorMeshes,
} from './meshes/floor-meshes';
import { highlightGeometry } from './meshes/highlight';
import { floorObjects } from './meshes/objects';
import { SceneRegistry } from './scene-registry';
import { selectPicked } from './select';

type Controls = ComponentRef<typeof OrbitControls>;

const NO_SELECTION: readonly SelectionItem[] = [];

const Highlight = memo(function Highlight({
  floorId,
  meshes,
  registry,
}: {
  floorId: Id;
  meshes: FloorMeshes;
  registry: SceneRegistry;
}) {
  // Only the editor's floor has a selection.
  const selection = useEditorStore((s) => (s.floorId === floorId ? s.selection : NO_SELECTION));
  const highlight = useMemo(() => highlightGeometry(meshes, selection), [meshes, selection]);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    registry.highlights.set(floorId, highlight?.items ?? []);
    invalidate();
    return () => {
      registry.highlights.delete(floorId);
      highlight?.geometry.dispose();
    };
  }, [registry, floorId, highlight, invalidate]);

  return highlight ? (
    <mesh geometry={highlight.geometry} material={materials().highlight} renderOrder={1} />
  ) : null;
});

/** One floor: its merged walls and slabs, its device instances and its selection highlight. */
const FloorObject = memo(function FloorObject({
  floorId,
  base,
  registry,
}: {
  floorId: Id;
  base: number;
  registry: SceneRegistry;
}) {
  const floor = useModelStore((s) => s.model?.floors[floorId]);
  const meshes = useMemo(() => (floor ? floorMeshes(floor) : null), [floor]);
  const objects = useMemo(() => (meshes ? floorObjects(meshes) : []), [meshes]);
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    if (!meshes || !group.current) return;
    registry.floors.set(floorId, { group: group.current, base, meshes, pickables: objects });
    invalidate();
    return () => {
      registry.floors.delete(floorId);
    };
  }, [registry, floorId, base, meshes, objects, invalidate]);

  useEffect(
    () => () => {
      for (const o of objects) if (o instanceof InstancedMesh) o.dispose();
    },
    [objects],
  );
  useEffect(
    () => () => {
      // The cache may hand these out again; three.js uploads a disposed geometry anew when drawn.
      if (meshes) disposeFloorMeshes(meshes);
    },
    [meshes],
  );

  if (!meshes) return null;
  return (
    <group ref={group} position={[0, base, 0]}>
      {objects.map((o) => (
        <primitive key={o.uuid} object={o} dispose={null} />
      ))}
      <Highlight floorId={floorId} meshes={meshes} registry={registry} />
    </group>
  );
});

/** Points the camera at the drawn floors; false when there is nothing to fit yet. */
function fitToFloors(state: RootState, registry: SceneRegistry, controls: Controls | null) {
  const { camera, size, invalidate } = state;
  const bounds = stackedBounds(
    [...registry.floors.values()].map((e) => ({ bounds: e.meshes.geometry.bounds, base: e.base })),
  );
  if (!bounds || !controls || size.height === 0 || !('fov' in camera)) return false;
  const view = fitCamera(bounds, size.width / size.height, camera.fov);
  camera.position.set(...view.position);
  camera.near = view.near;
  camera.far = view.far;
  camera.updateProjectionMatrix();
  controls.target.set(...view.target);
  controls.update();
  invalidate();
  return true;
}

/**
 * Zooms to fit the visible floors when the view opens and when asked to. Until the person moves
 * the camera or selects something, a resize (the page settling) fits again.
 */
function CameraRig({
  registry,
  controlsRef,
  fittedRef,
}: {
  registry: SceneRegistry;
  controlsRef: RefObject<Controls | null>;
  fittedRef: RefObject<boolean>;
}) {
  const fitRequest = useView3dStore((s) => s.fitRequest);
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);

  useEffect(() => {
    fittedRef.current = fitToFloors(get(), registry, controlsRef.current);
  }, [fitRequest, get, registry, controlsRef, fittedRef]);
  useEffect(() => {
    if (fittedRef.current) fitToFloors(get(), registry, controlsRef.current);
  }, [size, get, registry, controlsRef, fittedRef]);
  // As in 2D: once something is selected, the side panel opening must not move the view.
  useEffect(
    () =>
      editorStore.subscribe((s, prev) => {
        if (s.selection !== prev.selection) fittedRef.current = false;
      }),
    [fittedRef],
  );

  return null;
}

const pointerKind = (type: string): PointerKind =>
  type === 'touch' || type === 'pen' ? type : 'mouse';

/** Taps pick and select; drags and pinches are left to the orbit controls. */
function Interaction({
  registry,
  onOpenFloor,
}: {
  registry: SceneRegistry;
  onOpenFloor: (floorId: Id) => void;
}) {
  const get = useThree((s) => s.get);
  const canvas = useThree((s) => s.gl.domElement);
  // The element the orbit controls listen on and capture pointers to.
  const el = useThree((s) => (s.events.connected as HTMLElement | undefined) ?? canvas);
  const openFloor = useRef(onOpenFloor);
  useEffect(() => {
    openFloor.current = onOpenFloor;
  }, [onOpenFloor]);

  useEffect(() => {
    const choose = (p: PointerInput) => {
      const { camera, size } = get();
      selectPicked(registry.pick(camera, size, p.x, p.y), p.shiftKey || p.modKey, (id) => {
        openFloor.current(id);
      });
    };
    const noop = () => undefined;
    const gestures = createGestureController({
      hover: noop,
      tap: choose,
      doubleTap: choose,
      dragStart: () => false,
      drag: noop,
      dragEnd: noop,
      dragCancel: noop,
      pan: noop,
      pinch: noop,
    });
    const input = (e: PointerEvent): PointerInput => {
      const rect = canvas.getBoundingClientRect();
      return {
        id: e.pointerId,
        kind: pointerKind(e.pointerType),
        button: e.button,
        buttons: e.buttons,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        time: e.timeStamp,
        panKey: false,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        modKey: e.ctrlKey || e.metaKey,
      };
    };
    const onDown = (e: PointerEvent) => {
      gestures.down(input(e));
    };
    const onMove = (e: PointerEvent) => {
      gestures.move(input(e));
    };
    const onUp = (e: PointerEvent) => {
      gestures.up(input(e));
    };
    const onCancel = (e: PointerEvent) => {
      gestures.cancel(input(e));
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    };
  }, [el, canvas, get, registry]);

  useEffect(() => {
    setView3dDevHook({
      screenPosition: (item) => {
        const { camera, size } = get();
        return registry.screenPosition(camera, size, item);
      },
      builds: buildCounts,
      highlighted: () => registry.highlighted(),
    });
    return () => {
      setView3dDevHook(undefined);
    };
  }, [get, registry]);

  return null;
}

/** The visible floors, stacked, with lights, orbit controls and tap selection. */
export function Scene({
  floorId,
  onOpenFloor,
}: {
  floorId: Id;
  onOpenFloor: (floorId: Id) => void;
}) {
  const model = useModelStore((s) => s.model);
  const choice = useView3dStore((s) => s.floors);
  const exploded = useView3dStore((s) => s.exploded);
  const visible = useMemo(
    () => (model ? visibleFloors(model, floorId, choice) : []),
    [model, floorId, choice],
  );
  const bases = useMemo(() => floorBases(visible, exploded), [visible, exploded]);
  const [registry] = useState(() => new SceneRegistry());
  const controlsRef = useRef<Controls>(null);
  const fittedRef = useRef(false);

  return (
    <>
      <hemisphereLight args={['#ffffff', '#94a3b8', 2]} />
      <directionalLight position={[40, 80, 60]} intensity={1.6} />
      {visible.map((floor) => (
        <FloorObject
          key={floor.id}
          floorId={floor.id}
          base={bases.get(floor.id) ?? 0}
          registry={registry}
        />
      ))}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        onStart={() => {
          fittedRef.current = false;
        }}
      />
      <CameraRig registry={registry} controlsRef={controlsRef} fittedRef={fittedRef} />
      <Interaction registry={registry} onOpenFloor={onOpenFloor} />
    </>
  );
}
