import type { FloorData, Id, Pt } from '@el-karta/core';
import { Vector3, type Camera } from 'three';
import type { PointerInput } from '@/features/floorplan/canvas/gestures';
import { SNAP_PX, snappingStore } from '@/features/floorplan/snapping/snapping';
import { editorStore } from '@/features/floorplan/editor-store';
import { modelStore } from '@/model/store';
import type { SceneRegistry } from '../scene-registry';
import {
  changeEdit,
  changes,
  previewFloor,
  startGizmoDrag,
  type DragAmount,
  type DragOptions,
  type GizmoChange,
  type GizmoDrag,
} from './drag';
import { GRAB_PX, gizmoTarget, handleNear, type GizmoHandle, type GizmoTarget } from './handles';
import { gizmoStore } from './preview-store';
import { toThree } from '../meshes/merged';
import { pixelSize, pointerRay, screenHandles, toScreen, worldOf, type Size } from './screen';
import { closestOnAxis, hitLevel } from './ray';

/** What the controller needs to see the scene: the camera and canvas size of the current frame. */
export interface View {
  camera: Camera;
  size: Size;
}

/** The handles a gizmo shows, registered by the gizmo component while it is drawn. */
export interface GizmoEntry {
  floorId: Id;
  target: GizmoTarget;
  handles: readonly GizmoHandle[];
}

interface Drag {
  floorId: Id;
  handle: GizmoHandle;
  session: GizmoDrag;
  /** Where the pointer met the handle's constraint at the press: along its axis, or in its plane. */
  grab: number | Pt;
  /** Metres per pixel at the handle when the drag started. */
  scale: number;
  /** The last change shown, with the committed data and pointer it was computed from. */
  last: { change: GizmoChange; on: FloorData; amount: DragAmount; options: DragOptions } | null;
}

const committed = (floorId: Id) => modelStore.getState().model?.floors[floorId]?.data;

/**
 * Drags gizmo handles in the 3D view (ADR 0009): a press on a handle grabs it, each move turns the
 * pointer ray into a drag along the handle's constraint and previews the gizmo's change, release
 * commits it as one edit, and a cancel drops the preview.
 */
export class GizmoController {
  private pressed: { pointerId: number; handle: GizmoHandle; gizmo: GizmoEntry } | null = null;
  private drag: Drag | null = null;
  private unwatch: (() => void) | null = null;

  private abort: () => void = () => {
    this.cancel();
  };

  constructor(private readonly registry: SceneRegistry) {}

  /**
   * How to end a drag that can no longer go on (its item was removed, undone or deselected, or the
   * floor changed): the way Escape does, through the gesture controller. Without one it just drops
   * the preview.
   */
  onAbort(abort: (() => void) | null) {
    this.abort =
      abort ??
      (() => {
        this.cancel();
      });
  }

  /**
   * While a handle is held, follows the model and the editor: a change to the floor's data
   * recomputes the preview from the last pointer position (or aborts when the change is refused
   * or the item is gone), and a new selection or floor aborts.
   */
  private watch() {
    if (this.unwatch) return;
    const offModel = modelStore.subscribe(() => {
      this.refresh();
    });
    const offEditor = editorStore.subscribe((s) => {
      const held = this.pressed?.gizmo;
      if (!held) return;
      const target = gizmoTarget(s.selection);
      const same =
        s.floorId === held.floorId &&
        target?.collection === held.target.collection &&
        target.id === held.target.id;
      if (!same) this.drop();
    });
    this.unwatch = () => {
      offModel();
      offEditor();
    };
  }

  private stopWatching() {
    if (this.pressed || this.drag) return;
    this.unwatch?.();
    this.unwatch = null;
  }

  /** Lets go of the press and aborts any drag. */
  private drop() {
    this.pressed = null;
    if (this.drag) this.abort();
    if (this.drag) this.cancel();
    this.stopWatching();
  }

  private refresh() {
    const drag = this.drag;
    const data = drag && committed(drag.floorId);
    if (!drag?.last || data === drag.last.on) return;
    const change = data && drag.session.change(data, drag.last.amount, drag.last.options);
    if (!data || !change) {
      this.drop();
      return;
    }
    drag.last = { ...drag.last, change, on: data };
    gizmoStore.setState({ preview: { floorId: drag.floorId, data: previewFloor(data, change) } });
  }

  /** The handle at `(x, y)` canvas pixels within reach of a `kind` pointer, or null. */
  handleAt(view: View, x: number, y: number, kind: PointerInput['kind']): GizmoHandle | null {
    const gizmo = this.registry.gizmo;
    const floor = gizmo && this.registry.floors.get(gizmo.floorId);
    if (!gizmo || !floor) return null;
    const on = screenHandles(view.camera, view.size, floor.group, gizmo.handles);
    const name = handleNear(on, { x, y }, GRAB_PX[kind]);
    return gizmo.handles.find((h) => h.name === name) ?? null;
  }

  /** A press: grabs the handle under it, if any, and says whether it did. */
  press(view: View, p: PointerInput): boolean {
    if (this.pressed || this.drag) return false;
    const gizmo = this.registry.gizmo;
    const handle = gizmo && this.handleAt(view, p.x, p.y, p.kind);
    if (!gizmo || !handle) return false;
    this.pressed = { pointerId: p.id, handle, gizmo };
    this.watch();
    return true;
  }

  /** Whether `pointerId` pressed a handle; its taps and drags belong to the gizmo. */
  holds(pointerId: number): boolean {
    return this.pressed?.pointerId === pointerId;
  }

  release(pointerId: number) {
    if (this.pressed?.pointerId !== pointerId) return;
    this.pressed = null;
    this.stopWatching();
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  /** Starts dragging the pressed handle from where the press was. False when nothing was pressed. */
  start(view: View, start: PointerInput): boolean {
    const gizmo = this.pressed?.gizmo;
    const handle = this.pressed?.handle;
    const data = gizmo && committed(gizmo.floorId);
    const floor = gizmo && this.registry.floors.get(gizmo.floorId);
    if (!handle || !gizmo || !data || !floor) return false;
    const session = startGizmoDrag(data, gizmo.target, handle.name);
    if (!session) return false;
    const ray = pointerRay(view.camera, view.size, start.x, start.y, floor.base);
    const grab =
      handle.constraint.kind === 'axis'
        ? (closestOnAxis(ray, handle.at, handle.constraint.dir) ?? 0)
        : (hitLevel(ray, handle.at.z) ?? handle.at);
    floor.group.updateWorldMatrix(true, false);
    const scale = pixelSize(view.camera, view.size, worldOf(floor.group, handle.at));
    this.drag = { floorId: gizmo.floorId, handle, session, grab, scale, last: null };
    gizmoStore.setState({ active: handle.name });
    return true;
  }

  private amount(view: View, p: PointerInput, drag: Drag): DragAmount | null {
    const base = this.registry.floors.get(drag.floorId)?.base ?? 0;
    const ray = pointerRay(view.camera, view.size, p.x, p.y, base);
    const { handle, grab } = drag;
    if (handle.constraint.kind === 'axis') {
      const at = closestOnAxis(ray, handle.at, handle.constraint.dir);
      return at === null || typeof grab !== 'number' ? null : { kind: 'axis', along: at - grab };
    }
    const hit = hitLevel(ray, handle.at.z);
    return hit === null || typeof grab === 'number'
      ? null
      : { kind: 'level', shift: { x: hit.x - grab.x, y: hit.y - grab.y } };
  }

  /** Previews the drag to `p`. A pointer off the constraint or a refused change keeps the last preview. */
  move(view: View, p: PointerInput) {
    const drag = this.drag;
    const data = drag && committed(drag.floorId);
    const amount = drag && data && this.amount(view, p, drag);
    if (!drag || !data || !amount) return;
    const snaps = snappingStore.getState().enabled && !p.altKey;
    const options = { snap: snaps ? SNAP_PX[p.kind] * drag.scale : null, round: snaps };
    const change = drag.session.change(data, amount, options);
    if (!change) return;
    drag.last = { change, on: data, amount, options };
    gizmoStore.setState({ preview: { floorId: drag.floorId, data: previewFloor(data, change) } });
  }

  /** Commits the last preview as one edit. */
  end(view: View, p: PointerInput) {
    this.move(view, p);
    const drag = this.drag;
    // Detached first, so the edit's own model update does not recompute the preview.
    this.drag = null;
    const data = drag && committed(drag.floorId);
    const last = drag?.last;
    // Only a change computed on the data as it is now; applied before the preview is dropped, so
    // the old data is never drawn in between.
    if (drag && last && data && last.on === data && changes(data, last.change))
      modelStore.getState().apply(changeEdit(drag.floorId, last.change));
    this.cancel();
  }

  /** Drops the preview; the data stays as it was. */
  cancel() {
    this.drag = null;
    gizmoStore.setState({ preview: null, active: null });
    this.stopWatching();
  }

  /** Where a handle of the shown gizmo is drawn, in canvas pixels, or null. */
  handlePosition(view: View, name: GizmoHandle['name']): Pt | null {
    const gizmo = this.registry.gizmo;
    const floor = gizmo && this.registry.floors.get(gizmo.floorId);
    const handle = gizmo?.handles.find((h) => h.name === name);
    if (!floor || !handle) return null;
    const at = screenHandles(view.camera, view.size, floor.group, [handle])[0]?.at;
    if (!at) return null;
    const inside = at.x >= 0 && at.y >= 0 && at.x <= view.size.width && at.y <= view.size.height;
    return inside ? at : null;
  }

  /**
   * The unit direction on screen in which dragging an axis handle moves it the positive way, or
   * null for a corner or a handle not shown.
   */
  handleAxis(view: View, name: GizmoHandle['name']): Pt | null {
    const gizmo = this.registry.gizmo;
    const floor = gizmo && this.registry.floors.get(gizmo.floorId);
    const handle = gizmo?.handles.find((h) => h.name === name);
    if (!floor || handle?.constraint.kind !== 'axis') return null;
    const centre = worldOf(floor.group, handle.at);
    const step = new Vector3(...toThree(handle.constraint.dir)).multiplyScalar(
      pixelSize(view.camera, view.size, centre),
    );
    const a = toScreen(view.camera, view.size, centre);
    const b = toScreen(view.camera, view.size, centre.add(step));
    const length = a && b && Math.hypot(b.x - a.x, b.y - a.y);
    return a && b && length ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length } : null;
  }
}
