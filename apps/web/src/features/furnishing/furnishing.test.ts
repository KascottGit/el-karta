import { createRegistry, validateModel, type Device, type Pt, type Room } from '@el-karta/core';
import { FURNITURE_SIZES, furnishingPlugin } from '@el-karta/plugin-furnishing';
import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore } from '@/model/store';
import { editorStore } from '@/features/floorplan/editor-store';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { setSnapping } from '@/features/floorplan/snapping/snapping';
import { pointer, projectWith, pt, testCtx } from '@/features/floorplan/walls/test-fixtures';
import { deviceDragStore } from '@/features/devices/device-drag';
import { furnishingStore } from './furnishing-store';
import {
  asFurniture,
  normalizeDegrees,
  roomAt,
  rotationTowards,
  withType,
  type Furniture,
} from './furniture-edits';
import { furnitureMove, furnitureRotate } from './furniture-handles';
import { furnitureTool } from './furniture-tool';

let floorId = '';
const ctx = (): CanvasContext => testCtx(floorId);
const data = () => modelStore.getState().model!.floors[floorId]!.data;
const items = () => Object.values(data().devices);
const only = () => asFurniture(items()[0])!;

const square = (x0: number, y0: number, side: number): Pt[] => [
  pt(x0, y0),
  pt(x0 + side, y0),
  pt(x0 + side, y0 + side),
  pt(x0, y0 + side),
];
const room = (id: string, polygon: Pt[]): Room => ({
  id,
  name: id,
  type: 'other',
  polygon,
  provenance: { status: 'manual' },
});

beforeEach(() => {
  const project = projectWith();
  floorId = project.floorId;
  const floor = project.model.floors[floorId]!;
  floor.data.rooms = { big: room('big', square(0, 0, 10)), small: room('small', square(1, 1, 3)) };
  modelStore.getState().load(project.model, { discardUnsaved: true });
  editorStore.getState().openFloor(floorId);
  editorStore.getState().select([]);
  furnishingStore.setState({ type: 'desk', preview: null, drag: null });
  deviceDragStore.setState({ drag: null });
  setSnapping(true);
});

describe('furniture edits', () => {
  it('finds the smallest room under a point, or none', () => {
    expect(roomAt(data(), pt(2, 2))).toBe('small');
    expect(roomAt(data(), pt(8, 8))).toBe('big');
    expect(roomAt(data(), pt(12, 2))).toBeUndefined();
  });

  it('turns the back towards the pointer, in degrees clockwise on screen, with steps', () => {
    const c = pt(0, 0);
    expect(rotationTowards(c, pt(0, -1), 0)).toBeCloseTo(0);
    expect(rotationTowards(c, pt(1, 0), 0)).toBeCloseTo(90);
    expect(rotationTowards(c, pt(0, 1), 0)).toBeCloseTo(180);
    expect(rotationTowards(c, pt(-1, 0), 0)).toBeCloseTo(270);
    expect(rotationTowards(c, pt(1, -0.9), 15)).toBe(45);
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(720)).toBe(0);
  });

  it('keeps a resized item’s size when its type changes, else takes the new default', () => {
    furnitureTool.onTap!(pointer(pt(2, 2)), ctx());
    const desk = only();
    expect(withType(desk, 'bed').placement.size).toEqual(FURNITURE_SIZES.bed);
    const resized: Furniture = {
      ...desk,
      placement: { ...desk.placement, size: { x: 2, y: 1, z: 1 } },
    };
    expect(withType(resized, 'bed').placement.size).toEqual({ x: 2, y: 1, z: 1 });
  });
});

describe('furniture tool', () => {
  it('places the chosen type in the room under the tap, selects it, as one undo step', () => {
    furnishingStore.setState({ type: 'sofa' });
    furnitureTool.onTap!(pointer(pt(2, 2)), ctx());
    const sofa = only();
    expect(sofa).toMatchObject({
      domain: 'furnishing',
      type: 'sofa',
      roomId: 'small',
      placement: { kind: 'floor', at: pt(2, 2), rotation: 0, size: FURNITURE_SIZES.sofa },
    });
    expect(editorStore.getState().selection).toEqual([{ collection: 'devices', id: sofa.id }]);
    expect(validateModel(modelStore.getState().model!, createRegistry([furnishingPlugin]))).toEqual(
      [],
    );
    modelStore.getState().undo();
    expect(items()).toEqual([]);
  });

  it('places outside every room without a room', () => {
    furnitureTool.onTap!(pointer(pt(12, 2)), ctx());
    expect('roomId' in only()).toBe(false);
  });

  it('previews on hover and clears the preview when the pointer leaves', () => {
    furnitureTool.onHover!(pointer(pt(3, 3)), ctx());
    expect(furnishingStore.getState().preview?.device.placement).toMatchObject({ at: pt(3, 3) });
    furnitureTool.onLeave!(ctx());
    expect(furnishingStore.getState().preview).toBeNull();
  });
});

describe('furniture handles', () => {
  let desk: Device;
  beforeEach(() => {
    furnitureTool.onTap!(pointer(pt(2, 2)), ctx());
    desk = only();
  });

  it('move the item by where it was grabbed, previewing until the drop, as one undo step', () => {
    const grab = pointer(pt(2.3, 2.1));
    furnitureMove.onDragStart!({ id: desk.id }, grab, grab, ctx());
    furnitureMove.onDrag({ id: desk.id }, pointer(pt(7.3, 7.1)), ctx());
    expect(only().placement.at).toEqual(pt(2, 2));
    const preview = deviceDragStore.getState().drag;
    expect(preview?.floorId).toBe(floorId);
    expect(asFurniture(preview?.device)?.placement.at.x).toBeCloseTo(7);
    furnitureMove.onDragEnd!({ id: desk.id }, pointer(pt(7.3, 7.1)), ctx());
    expect(deviceDragStore.getState().drag).toBeNull();
    expect(only().placement.at.x).toBeCloseTo(7);
    expect(only().placement.at.y).toBeCloseTo(7);
    expect(only().roomId).toBe('big');
    modelStore.getState().undo();
    expect(only().placement.at).toEqual(pt(2, 2));
    expect(only().roomId).toBe('small');
  });

  it('turn the item towards the pointer in steps, unless Alt is held', () => {
    const start = pointer(pt(2, 1));
    furnitureRotate.onDragStart!({ id: desk.id }, start, start, ctx());
    furnitureRotate.onDrag({ id: desk.id }, pointer(pt(3, 1.1)), ctx());
    expect(asFurniture(deviceDragStore.getState().drag?.device)?.placement.rotation).toBe(45);
    furnitureRotate.onDragEnd!({ id: desk.id }, pointer(pt(3, 1.1)), ctx());
    expect(only().placement.rotation).toBe(45);
    modelStore.getState().undo();
    expect(only().placement.rotation).toBe(0);

    furnitureRotate.onDragStart!({ id: desk.id }, start, start, ctx());
    furnitureRotate.onDragEnd!({ id: desk.id }, pointer(pt(3, 1.1), { altKey: true }), ctx());
    expect(only().placement.rotation).toBeCloseTo(48.01, 1);
  });

  it('make no edit for a drag that ends where it started, and drop the preview on cancel', () => {
    const past = modelStore.getState().past.length;
    const grab = pointer(pt(2, 2));
    furnitureMove.onDragStart!({ id: desk.id }, grab, grab, ctx());
    furnitureMove.onDragEnd!({ id: desk.id }, grab, ctx());
    expect(modelStore.getState().past).toHaveLength(past);

    furnitureMove.onDragStart!({ id: desk.id }, grab, grab, ctx());
    furnitureMove.onDrag({ id: desk.id }, pointer(pt(5, 5)), ctx());
    furnitureMove.onDragCancel!({ id: desk.id }, ctx());
    expect(deviceDragStore.getState().drag).toBeNull();
    expect(only().placement.at).toEqual(pt(2, 2));
  });
});
