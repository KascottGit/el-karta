import {
  createEmptyProject,
  putSpaceItem,
  removeSpaceItem,
  type Id,
  type Pt,
  type Room,
  type Wall,
} from '@el-karta/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import type { CanvasContext, CanvasPointer } from '../canvas/extension';
import { midpointHandle, vertexHandle } from './area-handles';
import { fillRoomTool, roomTool, zoneTool } from './area-tools';
import { setSnapping } from '../snapping/snapping';
import { areasUiStore } from './areas-ui-store';

const pt = (x: number, y: number): Pt => ({ x, y });

let floorId: Id;
// One pixel is a centimetre, so the 10 px mouse snap reaches 10 cm.
const ctx = (): CanvasContext => ({
  floorId,
  itemAt: () => null,
  pxToWorld: (px) => px / 100,
  zoomToFit: () => {},
});

const at = (x: number, y: number, extra: Partial<CanvasPointer> = {}): CanvasPointer => ({
  world: pt(x, y),
  screen: pt(x * 100, y * 100),
  kind: 'mouse',
  shiftKey: false,
  altKey: false,
  modKey: false,
  onHandle: false,
  ...extra,
});

const key = (k: string) => ({ key: k }) as KeyboardEvent;

const wall = (a: Pt, b: Pt): Wall => ({
  id: crypto.randomUUID(),
  a,
  b,
  thickness: 0.2,
  provenance: { status: 'manual' },
});

const floor = () => modelStore.getState().model!.floors[floorId]!.data;
const rooms = () => Object.values(floor().rooms);
const zones = () => Object.values(floor().zones);
const history = () => modelStore.getState().past.length;
const notice = () => areasUiStore.getState().notice;

function tapAll(tool: typeof roomTool, points: [number, number][]) {
  for (const [x, y] of points) tool.onTap!(at(x, y), ctx());
}

beforeEach(() => {
  const model = createEmptyProject({
    id: () => crypto.randomUUID(),
    name: 'Test',
    kind: 'home',
    buildingName: 'Hus',
    floorName: 'Plan 1',
  });
  floorId = Object.keys(model.floors)[0]!;
  modelStore.getState().load(model, { discardUnsaved: true });
  for (const [a, b] of [
    [pt(0, 0), pt(4, 0)],
    [pt(4, 0), pt(4, 3)],
    [pt(4, 3), pt(0, 3)],
    [pt(0, 3), pt(0, 0)],
  ] as const) {
    modelStore.getState().apply(putSpaceItem(floorId, 'walls', wall(a, b)));
  }
  editorStore.getState().openFloor(floorId);
  editorStore.getState().select([]);
  editorStore.getState().setDrawing(null);
  areasUiStore.setState({ snap: null, fill: null, drag: null, drawingFloorId: null, notice: null });
  setSnapping(true);
});

describe('room tool', () => {
  it('places snapped corners and closes on the first one, as one undo step', () => {
    const before = history();
    tapAll(roomTool, [
      [0.03, 0.02],
      [3.96, 0],
      [4, 2.95],
      [0, 3.04],
    ]);
    expect(editorStore.getState().drawing?.points).toEqual([
      pt(0, 0),
      pt(4, 0),
      pt(4, 3),
      pt(0, 3),
    ]);
    roomTool.onTap!(at(0.02, 0.01), ctx());

    const [room] = rooms();
    expect(room).toMatchObject({
      name: 'Rum 1',
      type: 'other',
      polygon: [pt(0, 0), pt(4, 0), pt(4, 3), pt(0, 3)],
    });
    expect(editorStore.getState().drawing).toBeNull();
    expect(editorStore.getState().selection).toEqual([{ collection: 'rooms', id: room!.id }]);
    expect(history()).toBe(before + 1);
    modelStore.getState().undo();
    expect(rooms()).toEqual([]);
  });

  it('does not snap with Alt held or with snapping turned off', () => {
    roomTool.onTap!(at(0.03, 0.02, { altKey: true }), ctx());
    expect(editorStore.getState().drawing?.points).toEqual([pt(0.03, 0.02)]);
    setSnapping(false);
    roomTool.onTap!(at(3.96, 0.01), ctx());
    expect(editorStore.getState().drawing?.points.at(-1)).toEqual(pt(3.96, 0.01));
  });

  it('snaps to the corners of other rooms and to angle steps from the last corner', () => {
    modelStore.getState().apply(
      putSpaceItem(floorId, 'rooms', {
        id: crypto.randomUUID(),
        name: 'Kök',
        type: 'kitchen',
        polygon: [pt(10, 10), pt(12, 10), pt(12, 12)],
        provenance: { status: 'manual' },
      }),
    );
    roomTool.onTap!(at(12.05, 11.96), ctx());
    expect(editorStore.getState().drawing?.points).toEqual([pt(12, 12)]);
    roomTool.onHover!(at(15, 12.1), ctx());
    expect(areasUiStore.getState().snap?.kind).toBe('angle');
    expect(editorStore.getState().drawing?.hover?.y).toBeCloseTo(12);
  });

  it('on Escape or a tool switch, adds a valid polygon and drops an invalid one with a notice', () => {
    tapAll(roomTool, [
      [10, 10],
      [12, 10],
      [12, 12],
    ]);
    roomTool.onDeactivate!(ctx());
    expect(rooms()).toHaveLength(1);
    expect(editorStore.getState().drawing).toBeNull();

    tapAll(roomTool, [
      [20, 20],
      [22, 20],
    ]);
    roomTool.onDeactivate!(ctx());
    expect(rooms()).toHaveLength(1);
    expect(editorStore.getState().drawing).toBeNull();
    expect(notice()).toBe('issues.room.polygon-too-few-points');
  });

  it('adds the polygon to the floor it was started on', () => {
    tapAll(roomTool, [
      [10, 10],
      [12, 10],
      [12, 12],
    ]);
    const started = floorId;
    floorId = crypto.randomUUID();
    roomTool.onDeactivate!(ctx());
    floorId = started;
    expect(rooms()).toHaveLength(1);
  });

  it('names new rooms with the smallest unused number', () => {
    const square = (x: number): [number, number][] => [
      [x, 10],
      [x + 1, 10],
      [x + 1, 11],
    ];
    for (const x of [10, 20, 30]) {
      tapAll(roomTool, square(x));
      roomTool.onKeyDown!(key('Enter'), ctx());
    }
    expect(rooms().map((r) => r.name)).toEqual(['Rum 1', 'Rum 2', 'Rum 3']);
    const second = rooms().find((r) => r.name === 'Rum 2')!;
    modelStore.getState().apply(removeSpaceItem(floorId, 'rooms', second.id));
    tapAll(roomTool, square(40));
    roomTool.onKeyDown!(key('Enter'), ctx());
    expect(
      rooms()
        .map((r) => r.name)
        .sort(),
    ).toEqual(['Rum 1', 'Rum 2', 'Rum 3']);
  });

  it('ignores a tap on the last corner again', () => {
    tapAll(roomTool, [
      [1, 1],
      [1, 1],
    ]);
    expect(editorStore.getState().drawing?.points).toEqual([pt(1, 1)]);
  });

  it('shows why a self-intersecting polygon is not added, and keeps drawing', () => {
    tapAll(roomTool, [
      [10, 10],
      [12, 12],
      [12, 10],
      [10, 12],
    ]);
    expect(roomTool.onKeyDown!(key('Enter'), ctx())).toBe(true);
    expect(rooms()).toEqual([]);
    expect(notice()).toBe('issues.room.polygon-self-intersecting');
    expect(editorStore.getState().drawing?.points).toHaveLength(4);

    expect(roomTool.onKeyDown!(key('Backspace'), ctx())).toBe(true);
    expect(editorStore.getState().drawing?.points).toHaveLength(3);
    expect(notice()).toBeNull();
  });

  it('closes on a double tap and needs three corners', () => {
    tapAll(roomTool, [
      [10, 10],
      [12, 10],
    ]);
    roomTool.onDoubleTap!(at(12, 10), ctx());
    expect(notice()).toBe('issues.room.polygon-too-few-points');
    roomTool.onTap!(at(12, 12), ctx());
    roomTool.onDoubleTap!(at(12, 12), ctx());
    expect(rooms()).toHaveLength(1);
  });

  it('leaves keys alone when nothing is being drawn', () => {
    expect(roomTool.onKeyDown!(key('Backspace'), ctx())).toBe(false);
  });
});

describe('zone tool', () => {
  it('draws a zone with a numbered name', () => {
    tapAll(zoneTool, [
      [10, 10],
      [12, 10],
      [12, 12],
    ]);
    zoneTool.onDoubleTap!(at(12, 12), ctx());
    expect(zones()).toMatchObject([
      { name: 'Zon 1', polygon: [pt(10, 10), pt(12, 10), pt(12, 12)] },
    ]);
    expect(rooms()).toEqual([]);
  });
});

describe('fill room tool', () => {
  it('previews and adds the room enclosed by the walls', () => {
    fillRoomTool.onHover!(at(1, 1), ctx());
    expect(areasUiStore.getState().fill).toHaveLength(4);
    fillRoomTool.onTap!(at(1, 1), ctx());
    expect(rooms()).toHaveLength(1);
    expect(rooms()[0]!.polygon).toHaveLength(4);
  });

  it('selects the existing room instead of adding the same one twice', () => {
    fillRoomTool.onTap!(at(1, 1), ctx());
    editorStore.getState().select([]);
    fillRoomTool.onTap!(at(3, 2), ctx());
    expect(rooms()).toHaveLength(1);
    expect(editorStore.getState().selection).toEqual([{ collection: 'rooms', id: rooms()[0]!.id }]);
  });

  it('explains when the walls do not enclose the point', () => {
    fillRoomTool.onTap!(at(6, 1), ctx());
    expect(rooms()).toEqual([]);
    expect(notice()).toBe('areas.notEnclosed');
  });
});

describe('vertex handles', () => {
  let room: Room;
  beforeEach(() => {
    fillRoomTool.onTap!(at(1, 1), ctx());
    room = rooms()[0]!;
  });
  const corner = (p: Pt) => room.polygon.findIndex((q) => q.x === p.x && q.y === p.y);
  const polygon = () => floor().rooms[room.id]!.polygon;

  it('moves a vertex with a preview and one undo step', () => {
    const before = history();
    const payload = { collection: 'rooms' as const, id: room.id, index: corner(pt(4, 3)) };
    vertexHandle.onDrag(payload, at(5, 3.5), ctx());
    expect(areasUiStore.getState().drag?.polygon).toContainEqual(pt(5, 3.5));
    expect(polygon()).toEqual(room.polygon);
    vertexHandle.onDrag(payload, at(5, 4), ctx());
    vertexHandle.onDragEnd!(payload, at(5, 4), ctx());
    expect(areasUiStore.getState().drag).toBeNull();
    expect(polygon()).toContainEqual(pt(5, 4));
    expect(history()).toBe(before + 1);
    modelStore.getState().undo();
    expect(polygon()).toEqual(room.polygon);
  });

  it('inserts a vertex dragged out of a midpoint, then removes it when dropped on a neighbour', () => {
    const top = { collection: 'rooms' as const, id: room.id, index: corner(pt(0, 0)) };
    midpointHandle.onDragEnd!(top, at(2, -1), ctx());
    expect(polygon()).toHaveLength(5);
    const inserted = polygon().findIndex((p) => p.x === 2 && p.y === -1);
    expect(inserted).toBeGreaterThanOrEqual(0);

    vertexHandle.onDragEnd!({ ...top, index: inserted }, at(0.03, 0.02), ctx());
    expect(polygon()).toHaveLength(4);
  });

  it('keeps at least three vertices', () => {
    modelStore
      .getState()
      .apply(putSpaceItem(floorId, 'rooms', { ...room, polygon: [pt(0, 0), pt(4, 0), pt(4, 3)] }));
    const before = history();
    vertexHandle.onDragEnd!({ collection: 'rooms', id: room.id, index: 1 }, at(0.02, 0), ctx());
    expect(polygon()).toHaveLength(3);
    expect(notice()).toBe('issues.room.polygon-too-few-points');
    expect(history()).toBe(before);
  });

  it('refuses a drag that makes the outline cross itself', () => {
    const before = history();
    const payload = { collection: 'rooms' as const, id: room.id, index: corner(pt(4, 3)) };
    vertexHandle.onDragEnd!(payload, at(2, -1), ctx());
    expect(polygon()).toEqual(room.polygon);
    expect(notice()).toBe('issues.room.polygon-self-intersecting');
    expect(history()).toBe(before);
  });

  it('lets a broken outline be mended a step at a time', () => {
    const bowtie = [pt(0, 0), pt(4, 3), pt(4, 0), pt(0, 3), pt(-1, 1)];
    modelStore.getState().apply(putSpaceItem(floorId, 'rooms', { ...room, polygon: bowtie }));
    vertexHandle.onDragEnd!({ collection: 'rooms', id: room.id, index: 4 }, at(-2.5, 1.3), ctx());
    expect(polygon()).toContainEqual(pt(-2.5, 1.3));
  });

  it('adds no undo step for a drag that ends where it started', () => {
    const before = history();
    const payload = { collection: 'rooms' as const, id: room.id, index: corner(pt(4, 3)) };
    vertexHandle.onDragEnd!(payload, at(4.01, 3.01), ctx());
    expect(history()).toBe(before);
  });

  it('drops the preview when the drag is cancelled', () => {
    const payload = { collection: 'rooms' as const, id: room.id, index: 0 };
    vertexHandle.onDrag(payload, at(5, 5), ctx());
    vertexHandle.onDragCancel!(payload, ctx());
    expect(areasUiStore.getState().drag).toBeNull();
    expect(polygon()).toEqual(room.polygon);
  });
});
