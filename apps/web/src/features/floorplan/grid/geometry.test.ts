import {
  emptyFloorData,
  evenGrid,
  generateProject,
  type FloorData,
  type Provenance,
} from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { coveringLines, DEFAULT_SPACING, nextLinePos } from './defaults';
import { contentBounds, gridExtent, gridFitBounds } from './extent';
import { itemAnchor, selectionCells } from './item-anchor';
import { formatNumber, parseNumber } from './number-text';

const manual: Provenance = { status: 'manual' };

function floor(): FloorData {
  const data = emptyFloorData(2.5);
  data.walls.w = {
    id: 'w',
    a: { x: 0, y: 0 },
    b: { x: 10, y: 0 },
    thickness: 0.2,
    provenance: manual,
  };
  data.openings.o = {
    id: 'o',
    wallId: 'w',
    kind: 'door',
    offset: 7,
    width: 1,
    height: 2.1,
    provenance: manual,
  };
  data.rooms.r = {
    id: 'r',
    name: 'Kök',
    type: 'kitchen',
    polygon: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 8 },
      { x: 0, y: 8 },
    ],
    provenance: manual,
  };
  data.zones.z = {
    id: 'z',
    name: 'Zon',
    polygon: [
      { x: -2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 3 },
    ],
    provenance: manual,
  };
  data.devices.d = {
    id: 'd',
    domain: 'power',
    type: 'outlet',
    label: 'Uttag',
    placement: { kind: 'floor', at: { x: 9, y: 7 } },
    props: {},
    ports: [],
    provenance: manual,
  };
  return data;
}

const grid = evenGrid({
  origin: { x: 0, y: 0 },
  x: { count: 3, spacing: 5 },
  y: { count: 3, spacing: 4 },
});

describe('grid extent', () => {
  it('covers walls, rooms and zones', () => {
    expect(contentBounds(floor())).toEqual({ minX: -2, minY: 0, maxX: 10, maxY: 8 });
    expect(contentBounds(emptyFloorData(2.5))).toBeNull();
  });

  it('spans the content and the lines', () => {
    const content = { minX: -2, minY: 0, maxX: 10, maxY: 8 };
    expect(gridExtent(grid, content)).toEqual({ minX: -2, minY: 0, maxX: 10, maxY: 8 });
    const wide = evenGrid({
      origin: { x: -5, y: 2 },
      x: { count: 4, spacing: 5 },
      y: { count: 2, spacing: 10 },
    });
    expect(gridExtent(wide, content)).toEqual({ minX: -5, minY: 0, maxX: 10, maxY: 12 });
  });

  it('borrows the other range for an axis without lines or content', () => {
    const xOnly = { xLines: grid.xLines, yLines: [] };
    expect(gridExtent(xOnly, null)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(gridExtent(xOnly, { minX: 1, minY: 2, maxX: 3, maxY: 4 })).toEqual({
      minX: 0,
      minY: 2,
      maxX: 10,
      maxY: 4,
    });
    expect(
      gridExtent({ xLines: [], yLines: [] }, { minX: 0, minY: 0, maxX: 1, maxY: 1 }),
    ).toBeNull();
  });

  it('leaves room for the label bubbles when zooming to fit', () => {
    expect(gridFitBounds(grid, { minX: 0, minY: 0, maxX: 10, maxY: 5 })).toEqual({
      minX: -0.6,
      minY: -0.6,
      maxX: 10.6,
      maxY: 8.6,
    });
    expect(gridFitBounds({ xLines: [], yLines: [] }, null)).toBeNull();
  });

  it('bounds the large synthetic floor quickly', () => {
    const model = generateProject('large');
    const busiest = Object.values(model.floors).reduce((a, b) =>
      Object.keys(b.data.walls).length > Object.keys(a.data.walls).length ? b : a,
    );
    const started = performance.now();
    expect(contentBounds(busiest.data)).not.toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('grid location of items', () => {
  const data = floor();

  it('anchors walls at their middle, openings at their centre, areas at their centroid and devices where placed', () => {
    expect(itemAnchor(data, { collection: 'walls', id: 'w' })).toEqual({ x: 5, y: 0 });
    expect(itemAnchor(data, { collection: 'openings', id: 'o' })).toEqual({ x: 7.5, y: 0 });
    expect(itemAnchor(data, { collection: 'rooms', id: 'r' })).toEqual({ x: 2, y: 4 });
    expect(itemAnchor(data, { collection: 'zones', id: 'z' })).toEqual({ x: 0, y: 5 / 3 });
    expect(itemAnchor(data, { collection: 'devices', id: 'd' })).toEqual({ x: 9, y: 7 });
    expect(itemAnchor(data, { collection: 'connections', id: 'c' })).toBeNull();
    expect(itemAnchor(data, { collection: 'walls', id: 'gone' })).toBeNull();
  });

  it('lists the distinct cells of a selection in order, skipping items outside the grid', () => {
    const outside = floor();
    outside.devices.d!.placement = { kind: 'floor', at: { x: 40, y: 0 } };
    expect(
      selectionCells(data, grid, [
        { collection: 'devices', id: 'd' },
        { collection: 'walls', id: 'w' },
        { collection: 'openings', id: 'o' },
        { collection: 'rooms', id: 'r' },
      ]),
    ).toEqual(['C3', 'B1', 'A2']);
    expect(selectionCells(outside, grid, [{ collection: 'devices', id: 'd' }])).toEqual([]);
  });
});

describe('grid panel defaults', () => {
  it('covers a range from a start rounded down to 10 cm', () => {
    expect(coveringLines([0.37, 12.2], 6)).toEqual({ start: 0.3, count: 3 });
    expect(coveringLines([0.37, 12.4], 6)).toEqual({ start: 0.3, count: 4 });
    expect(coveringLines([0, 12], 6)).toEqual({ start: 0, count: 3 });
    expect(coveringLines([0, 1], 6)).toEqual({ start: 0, count: 2 });
    expect(coveringLines(null, 6)).toEqual({ start: 0, count: 4 });
  });

  it('puts a new line one spacing past the last', () => {
    expect(nextLinePos(grid.xLines, 0)).toBe(15);
    expect(nextLinePos([{ label: 'A', pos: 2 }], 0)).toBe(2 + DEFAULT_SPACING);
    expect(nextLinePos([], -3)).toBe(-3);
  });

  it('reads and writes numbers with a decimal comma', () => {
    expect(formatNumber(6.5)).toBe('6,5');
    expect(formatNumber(1.23456)).toBe('1,235');
    expect(parseNumber(formatNumber(-2.5))).toBe(-2.5);
    expect(parseNumber(' 3,25 ')).toBe(3.25);
    expect(parseNumber('3.25')).toBe(3.25);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('tre')).toBeNull();
  });
});
