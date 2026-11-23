import { putSpaceItem, removeSpaceItem, type Vec3 } from '@el-karta/core';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PointerInput } from '@/features/floorplan/canvas/gestures';
import { setSnapping } from '@/features/floorplan/snapping/snapping';
import { projectWith } from '@/features/floorplan/walls/test-fixtures';
import { editorStore } from '@/features/floorplan/editor-store';
import { modelStore } from '@/model/store';
import { FloorFixture, pt } from '../geometry/test-fixtures';
import { floorMeshes } from '../meshes/floor-meshes';
import { toThree } from '../meshes/merged';
import { SceneRegistry } from '../scene-registry';
import { GizmoController } from './controller';
import { gizmoHandles, type GizmoTarget } from './handles';
import { gizmoStore } from './preview-store';

const SIZE = { width: 800, height: 600 };
const BASE = 3;

const input = (at: { x: number; y: number }, extra: Partial<PointerInput> = {}): PointerInput => ({
  id: 1,
  kind: 'mouse',
  button: 0,
  buttons: 1,
  x: at.x,
  y: at.y,
  time: 0,
  panKey: false,
  shiftKey: false,
  altKey: false,
  modKey: false,
  ...extra,
});

/** An L of walls with a window, on a floor drawn at `BASE`, seen from the south and above. */
function setup(target: (ids: { top: string; window: string }) => GizmoTarget) {
  const fixture = new FloorFixture(2.5);
  const top = fixture.wall(pt(0, 4), pt(6, 4), { thickness: 0.2 });
  fixture.wall(pt(6, 4), pt(6, 0), { thickness: 0.2 });
  const window = fixture.opening(top.id, 'window', 1, 1.2, 1.2, 0.9);
  const { model, floorId } = projectWith();
  model.floors[floorId] = { ...model.floors[floorId]!, data: fixture.data };
  modelStore.getState().load(model, { discardUnsaved: true });

  const registry = new SceneRegistry();
  const group = new Group();
  group.position.y = BASE;
  const floor = model.floors[floorId];
  registry.floors.set(floorId, { group, base: BASE, meshes: floorMeshes(floor), pickables: [] });
  const gizmo = target({ top: top.id, window: window.id });
  registry.showGizmo({ floorId, target: gizmo, handles: gizmoHandles(fixture.data, gizmo) });

  const camera = new PerspectiveCamera(50, SIZE.width / SIZE.height, 0.1, 100);
  camera.position.set(3, BASE + 8, 12);
  camera.lookAt(3, BASE + 1, 4);
  camera.updateMatrixWorld();
  const view = { camera, size: SIZE };
  const screen = (at: Vec3) => {
    const ndc = new Vector3(...toThree(at)).add(new Vector3(0, BASE, 0)).project(camera);
    return { x: ((ndc.x + 1) / 2) * SIZE.width, y: ((1 - ndc.y) / 2) * SIZE.height };
  };
  editorStore.getState().openFloor(floorId, [gizmo]);
  const controller = new GizmoController(registry);
  const data = () => modelStore.getState().model!.floors[floorId]!.data;
  /** Presses a handle, starts dragging it and moves the pointer over `to`. */
  const dragTo = (name: Parameters<GizmoController['handlePosition']>[1], to: Vec3) => {
    const start = input(controller.handlePosition(view, name)!);
    controller.press(view, start);
    controller.start(view, start);
    controller.move(view, input(screen(to)));
    return input(screen(to));
  };
  return { controller, view, screen, data, top, window, floorId, dragTo };
}

beforeEach(() => {
  gizmoStore.setState({ preview: null, active: null });
  setSnapping(true);
});

describe('GizmoController', () => {
  it('grabs a handle only within reach, farther for a finger', () => {
    const { controller, view } = setup(({ window }) => ({ collection: 'openings', id: window }));
    const at = controller.handlePosition(view, 'top')!;
    expect(controller.handleAt(view, at.x, at.y, 'mouse')?.name).toBe('top');
    expect(controller.handleAt(view, at.x + 18, at.y - 2, 'mouse')).toBeNull();
    expect(controller.handleAt(view, at.x + 18, at.y - 2, 'touch')?.name).toBe('top');
    expect(controller.press(view, input({ x: 5, y: 5 }))).toBe(false);
    expect(controller.holds(1)).toBe(false);
  });

  it('gives the screen direction that drags an axis handle the positive way', () => {
    const { controller, view, screen } = setup(({ window }) => ({
      collection: 'openings',
      id: window,
    }));
    const a = screen({ x: 1.6, y: 4, z: 1.5 });
    const b = screen({ x: 1.7, y: 4, z: 1.5 });
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const axis = controller.handleAxis(view, 'slide')!;
    expect(axis.x).toBeCloseTo((b.x - a.x) / length, 2);
    expect(axis.y).toBeCloseTo((b.y - a.y) / length, 2);
    expect(controller.handleAxis(view, 'top')!.y).toBeLessThan(-0.9);
  });

  it('previews a slide without touching the model, and commits it as one edit on release', () => {
    const { controller, view, screen, data, window, floorId } = setup(({ window }) => ({
      collection: 'openings',
      id: window,
    }));
    const start = input(controller.handlePosition(view, 'slide')!);
    expect(controller.press(view, start)).toBe(true);
    expect(controller.holds(1)).toBe(true);
    expect(controller.start(view, start)).toBe(true);
    expect(gizmoStore.getState().active).toBe('slide');
    // The pointer over the point half a metre further along the wall, at the handle's height.
    controller.move(view, input(screen({ x: 2.1, y: 4, z: 1.5 })));
    const preview = gizmoStore.getState().preview;
    expect(preview?.floorId).toBe(floorId);
    expect(preview?.data.openings[window.id]?.offset).toBeCloseTo(1.5, 6);
    expect(data().openings[window.id]?.offset).toBe(1);
    expect(modelStore.getState().past).toHaveLength(0);

    controller.end(view, input(screen({ x: 2.1, y: 4, z: 1.5 })));
    expect(data().openings[window.id]?.offset).toBe(1.5);
    expect(modelStore.getState().past).toHaveLength(1);
    expect(gizmoStore.getState()).toEqual({ preview: null, active: null });
  });

  it('drops the preview on cancel and leaves the data alone', () => {
    const { controller, view, screen, data, window } = setup(({ window }) => ({
      collection: 'openings',
      id: window,
    }));
    const start = input(controller.handlePosition(view, 'end')!);
    controller.press(view, start);
    controller.start(view, start);
    controller.move(view, input(screen({ x: 3, y: 4, z: 1.5 })));
    expect(gizmoStore.getState().preview?.data.openings[window.id]?.width).toBeCloseTo(2, 6);
    controller.cancel();
    expect(gizmoStore.getState().preview).toBeNull();
    expect(data().openings[window.id]?.width).toBe(1.2);
    expect(modelStore.getState().past).toHaveLength(0);
  });

  it('drags a corner in the plane at the top of the wall, on a raised floor', () => {
    const { controller, view, screen, data, top } = setup(({ top }) => ({
      collection: 'walls',
      id: top,
    }));
    const start = input(controller.handlePosition(view, 'corner-a')!);
    controller.press(view, start);
    controller.start(view, start);
    const to = input(screen({ x: 0.5, y: 3.25, z: 2.5 }), { altKey: true });
    controller.move(view, to);
    controller.end(view, to);
    expect(data().walls[top.id]?.a.x).toBeCloseTo(0.5, 6);
    expect(data().walls[top.id]?.a.y).toBeCloseTo(3.25, 6);
  });

  it('moves a wall along its normal, its neighbour following', () => {
    const { controller, view, screen, data, top } = setup(({ top }) => ({
      collection: 'walls',
      id: top,
    }));
    const start = input(controller.handlePosition(view, 'move-right')!);
    controller.press(view, start);
    controller.start(view, start);
    // The right face is at y = 4.1; drag it to 4.6.
    const to = input(screen({ x: 3, y: 4.6, z: 1.25 }), { altKey: true });
    controller.end(view, to);
    const walls = Object.values(data().walls);
    expect(data().walls[top.id]?.a.y).toBeCloseTo(4.5, 6);
    expect(walls.find((w) => w.id !== top.id)?.a.y).toBeCloseTo(4.5, 6);
  });

  it('keeps a removed item removed when the drag ends', () => {
    const { controller, view, data, window, floorId, dragTo } = setup(({ window }) => ({
      collection: 'openings',
      id: window,
    }));
    const to = dragTo('top', { x: 1.6, y: 4, z: 2.3 });
    expect(gizmoStore.getState().preview).not.toBeNull();
    modelStore.getState().apply(removeSpaceItem(floorId, 'openings', window.id));
    expect(gizmoStore.getState().preview).toBeNull();
    controller.end(view, to);
    expect(data().openings[window.id]).toBeUndefined();
    expect(modelStore.getState().past).toHaveLength(1);
  });

  it('drops the drag when an undo removes the item, keeping the redo', () => {
    const { controller, view, data, window, floorId, dragTo } = setup(({ window }) => ({
      collection: 'openings',
      id: window,
    }));
    // Put back by an edit, so undo takes it away.
    modelStore.getState().apply(removeSpaceItem(floorId, 'openings', window.id));
    modelStore.getState().apply(putSpaceItem(floorId, 'openings', window));
    const to = dragTo('top', { x: 1.6, y: 4, z: 2.3 });
    modelStore.getState().undo();
    expect(gizmoStore.getState().preview).toBeNull();
    controller.end(view, to);
    expect(data().openings[window.id]).toBeUndefined();
    expect(modelStore.getState().past).toHaveLength(1);
    expect(modelStore.getState().future).toHaveLength(1);
  });

  it('recomputes the preview on new data and commits the drag on it', () => {
    const { controller, view, data, window, floorId, dragTo } = setup(({ window }) => ({
      collection: 'openings',
      id: window,
    }));
    const to = dragTo('top', { x: 1.6, y: 4, z: 2.3 });
    modelStore
      .getState()
      .apply(putSpaceItem(floorId, 'openings', { ...data().openings[window.id]!, width: 1.5 }));
    const preview = gizmoStore.getState().preview?.data.openings[window.id];
    expect(preview?.width).toBe(1.5);
    expect(preview?.height).toBeCloseTo(1.4, 6);
    controller.end(view, to);
    expect(data().openings[window.id]).toMatchObject({ width: 1.5, height: 1.4 });
    expect(modelStore.getState().past).toHaveLength(2);
  });

  it('drops the drag when the selection or the floor changes', () => {
    const { controller, view, data, window, floorId, dragTo } = setup(({ window }) => ({
      collection: 'openings',
      id: window,
    }));
    let to = dragTo('top', { x: 1.6, y: 4, z: 2.3 });
    editorStore.getState().select([]);
    expect(gizmoStore.getState().preview).toBeNull();
    controller.end(view, to);
    expect(modelStore.getState().past).toHaveLength(0);

    editorStore.getState().select([{ collection: 'openings', id: window.id }]);
    to = dragTo('top', { x: 1.6, y: 4, z: 2.3 });
    editorStore.getState().openFloor('elsewhere');
    expect(gizmoStore.getState().preview).toBeNull();
    expect(controller.holds(1)).toBe(false);
    controller.end(view, to);
    expect(data().openings[window.id]?.height).toBe(1.2);
    expect(modelStore.getState().past).toHaveLength(0);
    editorStore.getState().openFloor(floorId);
  });
});
