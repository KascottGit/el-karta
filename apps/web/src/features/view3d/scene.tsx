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
  pointerInput,
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
import { GizmoController } from './gizmos/controller';
import { Gizmo } from './gizmos/gizmo';
import { usePreviewData } from './gizmos/preview-store';
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
    // The material is shared; R3F would otherwise dispose it when the highlight unmounts.
    <mesh
      geometry={highlight.geometry}
      material={materials().highlight}
      renderOrder={1}
      dispose={null}
    />
  ) : null;
});

/**
 * One floor: its merged walls and slabs, its device instances, its selection highlight and the
 * gizmo of a selected wall or opening. During a gizmo drag it is drawn from the drag's preview.
 */
const FloorObject = memo(function FloorObject({
  floorId,
  base,
  registry,
}: {
  floorId: Id;
  base: number;
  registry: SceneRegistry;
}) {
  const committed = useModelStore((s) => s.model?.floors[floorId]);
  const preview = usePreviewData(floorId);
  const floor = useMemo(
    () => (committed && preview ? { ...committed, data: preview } : committed),
    [committed, preview],
  );
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
      {floor && <Gizmo floorId={floorId} data={floor.data} registry={registry} />}
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

/**
 * Taps pick and select; drags and pinches are left to the orbit controls, except a press on a
 * gizmo handle, which turns the orbit controls off until it is released and drags the handle.
 */
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
  const controls = useThree((s) => s.controls as Controls | null);
  const [gizmos] = useState(() => new GizmoController(registry));
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
    const unlessHandle = (p: PointerInput) => {
      if (!gizmos.holds(p.id)) choose(p);
    };
    const noop = () => undefined;
    const gestures = createGestureController({
      hover: (p) => {
        el.style.cursor = gizmos.handleAt(get(), p.x, p.y, p.kind) ? 'grab' : '';
      },
      tap: unlessHandle,
      doubleTap: unlessHandle,
      dragStart: (start) => gizmos.holds(start.id) && gizmos.start(get(), start),
      drag: (p) => {
        gizmos.move(get(), p);
      },
      dragEnd: (p) => {
        gizmos.end(get(), p);
      },
      dragCancel: () => {
        gizmos.cancel();
      },
      pan: noop,
      pinch: noop,
    });
    const input = (e: PointerEvent): PointerInput => pointerInput(e, canvas, false);
    const lift = (p: PointerInput) => {
      if (!gizmos.holds(p.id)) return;
      gizmos.release(p.id);
      if (controls) controls.enabled = true;
      el.style.cursor = '';
    };
    // Capture phase, so a press on a handle turns the orbit controls off before they see it.
    const onDown = (e: PointerEvent) => {
      const p = input(e);
      if (p.button === 0 && gizmos.press(get(), p)) {
        if (controls) controls.enabled = false;
        el.setPointerCapture(e.pointerId);
        el.style.cursor = 'grabbing';
      }
      gestures.down(p);
    };
    const onMove = (e: PointerEvent) => {
      gestures.move(input(e));
    };
    const onUp = (e: PointerEvent) => {
      const p = input(e);
      gestures.up(p);
      lift(p);
    };
    const onCancel = (e: PointerEvent) => {
      const p = input(e);
      gestures.cancel(p);
      lift(p);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !gizmos.dragging) return;
      // Before the editor's shortcuts, which would also clear the selection.
      e.preventDefault();
      e.stopPropagation();
      gestures.cancelDrag();
    };
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('pointerup', onUp, true);
    el.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      gestures.cancelDrag();
      if (controls) controls.enabled = true;
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [el, canvas, get, registry, controls, gizmos]);

  useEffect(() => {
    setView3dDevHook({
      screenPosition: (item) => {
        const { camera, size } = get();
        return registry.screenPosition(camera, size, item);
      },
      builds: buildCounts,
      highlighted: () => registry.highlighted(),
      gizmoHandle: (name) => {
        const at = gizmos.handlePosition(get(), name);
        return at && { ...at, axis: gizmos.handleAxis(get(), name) };
      },
    });
    return () => {
      setView3dDevHook(undefined);
    };
  }, [get, registry, gizmos]);

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
