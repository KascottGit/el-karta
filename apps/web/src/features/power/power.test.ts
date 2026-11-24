import { validateModel, type Device, type Pt, type Room } from '@el-karta/core';
import {
  POWER_DEFAULT_HEIGHTS,
  POWER_PORTS,
  POWER_TYPES,
  type PowerType,
} from '@el-karta/plugin-power';
import { beforeEach, describe, expect, it } from 'vitest';
import { registry } from '@/plugins';
import { modelStore } from '@/model/store';
import { editorStore } from '@/features/floorplan/editor-store';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { pointer, projectWith, pt, testCtx, wall } from '@/features/floorplan/walls/test-fixtures';
import { deviceAppearance } from '@/features/devices/appearance';
import { deviceDragStore } from '@/features/devices/device-drag';
import { deviceMove } from '@/features/devices/device-move';
import { deviceTransforms } from '@/features/view3d/geometry/devices';
import { storeDevice } from '@/features/devices/device-edits';
import {
  asPower,
  withCount,
  withOffset,
  withPowerType,
  withProp,
  type PowerDevice,
} from './power-edits';
import { powerStore } from './power-store';
import { powerTool } from './power-tool';

let floorId = '';
const data = () => modelStore.getState().model!.floors[floorId]!.data;
const items = () => Object.values(data().devices);
const only = () => asPower(items()[0])!;

/** The canvas at `pxPerMetre` pixels per metre. */
const zoomed = (pxPerMetre: number): CanvasContext => ({
  ...testCtx(floorId),
  pxToWorld: (px) => px / pxPerMetre,
});
const ctx = () => zoomed(100);
const touch = (world: Pt) => pointer(world, { kind: 'touch' });

const square = (x0: number, y0: number, side: number): Pt[] => [
  pt(x0, y0),
  pt(x0 + side, y0),
  pt(x0 + side, y0 + side),
  pt(x0, y0 + side),
];
const kitchen: Room = {
  id: 'kitchen',
  name: 'Kök',
  type: 'kitchen',
  polygon: square(0, 0, 4),
  provenance: { status: 'manual' },
};

beforeEach(() => {
  // The room's walls, clockwise, so the room is on the right of each.
  const corners = square(0, 0, 4);
  const project = projectWith(
    corners.map((a, i) =>
      wall(a, corners[(i + 1) % 4]!, 0.2, ['top', 'east', 'bottom', 'west'][i]),
    ),
  );
  floorId = project.floorId;
  project.model.floors[floorId]!.data.rooms = { kitchen };
  modelStore.getState().load(project.model, { discardUnsaved: true });
  editorStore.getState().openFloor(floorId);
  editorStore.getState().select([]);
  powerStore.setState({ type: 'outlet', preview: null, missed: false });
  deviceDragStore.setState({ drag: null });
});

const place = (type: PowerType, at: Pt, c = ctx()) => {
  powerStore.setState({ type });
  powerTool.onTap!(touch(at), c);
};

describe('power tool', () => {
  it('puts an outlet on the wall face tapped, at its default height, selected, as one undo step', () => {
    place('outlet', pt(1.5, 0.25));
    const outlet = only();
    expect(outlet).toMatchObject({
      domain: 'power',
      type: 'outlet',
      roomId: 'kitchen',
      props: {},
      placement: {
        kind: 'wall',
        wallId: 'top',
        offset: 1.5,
        side: 'right',
        height: POWER_DEFAULT_HEIGHTS.outlet,
      },
      provenance: { status: 'manual' },
    });
    expect('count' in outlet).toBe(false);
    expect(outlet.ports.map((p) => p.kind)).toEqual([POWER_PORTS.powerIn]);
    expect(editorStore.getState().selection).toEqual([{ collection: 'devices', id: outlet.id }]);
    expect(validateModel(modelStore.getState().model!, registry)).toEqual([]);
    modelStore.getState().undo();
    expect(items()).toEqual([]);
  });

  it('reaches the same number of screen pixels from a wall face at every zoom', () => {
    // A finger reaches 20 px: 0.2 m at 100 px/m, 1 m at 20 px/m. The face is 0.1 m from the centre.
    place('switch', pt(1, 0.35), zoomed(100));
    expect(items()).toEqual([]);
    expect(powerStore.getState().missed).toBe(true);
    place('switch', pt(1, 0.25), zoomed(100));
    expect(items()).toHaveLength(1);
    place('switch', pt(2, 1.05), zoomed(20));
    expect(items()).toHaveLength(2);
    expect(powerStore.getState().missed).toBe(false);
    place('switch', pt(2, 1.15), zoomed(20));
    expect(items()).toHaveLength(2);
    expect(only().placement).toMatchObject({ height: POWER_DEFAULT_HEIGHTS.switch });
  });

  it('puts a ceiling light in the room tapped, and nothing outside every room', () => {
    place('ceiling_light', pt(2, 2));
    expect(only()).toMatchObject({
      type: 'ceiling_light',
      roomId: 'kitchen',
      placement: { kind: 'ceiling', roomId: 'kitchen', at: pt(2, 2) },
    });
    expect(only().ports.map((p) => p.kind)).toEqual([POWER_PORTS.powerIn, POWER_PORTS.controlIn]);
    place('ceiling_light', pt(6, 2));
    expect(items()).toHaveLength(1);
    expect(powerStore.getState().missed).toBe(true);
  });

  it('selects a device tapped instead of placing one', () => {
    place('outlet', pt(1, 0.2));
    const id = only().id;
    editorStore.getState().select([]);
    const onIt: CanvasContext = { ...ctx(), itemAt: () => ({ collection: 'devices', id }) };
    place('outlet', pt(1, 0.2), onIt);
    expect(items()).toHaveLength(1);
    expect(editorStore.getState().selection).toEqual([{ collection: 'devices', id }]);
  });

  it('previews on hover where it would place, and clears it on leave', () => {
    powerTool.onHover!(pointer(pt(2, 0.15)), ctx());
    expect(powerStore.getState().preview?.device.placement).toMatchObject({ wallId: 'top' });
    powerTool.onHover!(pointer(pt(2, 2)), ctx());
    expect(powerStore.getState().preview).toBeNull();
    powerTool.onHover!(pointer(pt(2, 0.15)), ctx());
    powerTool.onLeave!(ctx());
    expect(powerStore.getState().preview).toBeNull();
  });

  it('gives an outlet a 3D marker at its height on the wall face', () => {
    place('outlet', pt(1.5, 0.25));
    const [marker] = deviceTransforms(data());
    expect(marker).toMatchObject({ kind: 'marker', deviceId: only().id });
    if (marker?.kind !== 'marker') throw new Error('no marker');
    expect(marker.position.z).toBeCloseTo(POWER_DEFAULT_HEIGHTS.outlet);
    expect(marker.position.y).toBeCloseTo(0.1);
  });
});

describe('power markers', () => {
  it('give every power type its own marker in 2D and 3D', () => {
    const looks = POWER_TYPES.map((type) => deviceAppearance({ domain: 'power', type }));
    expect(new Set(looks.map((l) => `${l.shape}|${l.color}`)).size).toBe(POWER_TYPES.length);
  });
});

describe('moving power devices', () => {
  const drag = (id: string, from: Pt, to: Pt) => {
    deviceMove.onDragStart!({ id }, touch(from), touch(from), ctx());
    deviceMove.onDrag({ id }, touch(to), ctx());
  };

  it('slides an outlet along its wall, previewing until the drop, as one undo step', () => {
    place('outlet', pt(1, 0.2));
    const { id } = only();
    // Grabbed a little off the marker, which sits on the face at y = 0.1.
    drag(id, pt(1.02, 0.12), pt(3.02, 0.6));
    expect(only().placement).toMatchObject({ offset: 1 });
    expect(deviceDragStore.getState().drag?.device.placement).toMatchObject({
      wallId: 'top',
      offset: 3,
    });
    deviceMove.onDragEnd!({ id }, touch(pt(3.02, 0.6)), ctx());
    expect(deviceDragStore.getState().drag).toBeNull();
    expect(only().placement).toMatchObject({ wallId: 'top', side: 'right', offset: 3 });
    expect(only().placement).toMatchObject({ height: POWER_DEFAULT_HEIGHTS.outlet });
    modelStore.getState().undo();
    expect(only().placement).toMatchObject({ offset: 1 });
  });

  it('hops an outlet onto another wall face within reach', () => {
    place('outlet', pt(3.5, 0.2));
    const { id } = only();
    drag(id, pt(3.5, 0.1), pt(3.8, 2));
    deviceMove.onDragEnd!({ id }, touch(pt(3.8, 2)), ctx());
    expect(only().placement).toMatchObject({ wallId: 'east', offset: 2, side: 'right' });
  });

  it('keeps a ceiling light inside its room', () => {
    place('ceiling_light', pt(2, 2));
    const { id } = only();
    drag(id, pt(2, 2), pt(9, 2));
    deviceMove.onDragEnd!({ id }, touch(pt(9, 2)), ctx());
    const { placement } = only();
    if (placement.kind !== 'ceiling') throw new Error('not on the ceiling');
    expect(placement.at.x).toBeLessThan(4);
    expect(placement.at.x).toBeGreaterThan(3.99);
  });

  it('makes no edit for a drag that ends where it started, and drops the preview on cancel', () => {
    place('outlet', pt(1, 0.2));
    const { id } = only();
    const past = modelStore.getState().past.length;
    drag(id, pt(1, 0.1), pt(1, 0.1));
    deviceMove.onDragEnd!({ id }, touch(pt(1, 0.1)), ctx());
    expect(modelStore.getState().past).toHaveLength(past);
    drag(id, pt(1, 0.1), pt(2, 0.1));
    deviceMove.onDragCancel!({ id }, ctx());
    expect(deviceDragStore.getState().drag).toBeNull();
    expect(only().placement).toMatchObject({ offset: 1 });
  });
});

describe('power edits', () => {
  let outlet: PowerDevice;
  beforeEach(() => {
    place('outlet', pt(1, 0.2));
    outlet = withProp(withProp(only(), 'earthed', true), 'outdoor', false);
  });

  it('change the type, dropping props it lacks, adding ports, and taking its default height', () => {
    const sw = withPowerType(outlet, 'switch');
    expect(sw.props).toEqual({});
    expect(sw.ports.map((p) => p.kind)).toEqual([POWER_PORTS.powerIn, POWER_PORTS.controlOut]);
    expect(sw.ports[0]).toEqual(outlet.ports[0]);
    expect(sw.placement).toMatchObject({ height: POWER_DEFAULT_HEIGHTS.switch });
    const raised: PowerDevice = {
      ...outlet,
      placement: {
        ...(outlet.placement as Extract<Device['placement'], { kind: 'wall' }>),
        height: 0.5,
      },
    };
    expect(withPowerType(raised, 'wall_light').placement).toMatchObject({ height: 0.5 });
  });

  it('set the socket count, forget it when unknown, and drop it for types without one', () => {
    const double = withCount(outlet, 2);
    expect(double.count).toBe(2);
    expect('count' in withCount(double, null)).toBe(false);
    expect('count' in withPowerType(double, 'switch')).toBe(false);
    modelStore.getState().apply(storeDevice(withPowerType(double, 'switch')));
    expect('count' in only()).toBe(false);
  });

  it('set a prop, or forget it when unknown', () => {
    expect(outlet.props).toEqual({ earthed: true, outdoor: false });
    expect(withProp(outlet, 'earthed', undefined).props).toEqual({ outdoor: false });
  });

  it('clamp the offset to the wall', () => {
    expect(withOffset(data(), outlet, 9).placement).toMatchObject({ offset: 4 });
    expect(withOffset(data(), outlet, -1).placement).toMatchObject({ offset: 0 });
  });
});
