import { describe, expect, it } from 'vitest';
import {
  addGridLine,
  applyEdit,
  autoLabel,
  evenGrid,
  evenLines,
  Grid,
  gridCell,
  isAutoLabelled,
  moveGridLine,
  nearestGridLine,
  relabelGrid,
  removeGridLine,
  renameGridLine,
  setGrid,
  splitByDocument,
  type GridLine,
} from '../src/index.ts';
import { ModelBuilder } from './builder.ts';

const labels = (lines: readonly GridLine[]) => lines.map((l) => l.label);
const positions = (lines: readonly GridLine[]) => lines.map((l) => l.pos);

// A–D at x = 0, 6, 12, 18 and 1–4 at y = 0, 5, 10, 15.
const grid = evenGrid({
  origin: { x: 0, y: 0 },
  x: { count: 4, spacing: 6 },
  y: { count: 4, spacing: 5 },
});

describe('grid labels', () => {
  it('letters x lines A–Z, then AA, AB …, and numbers y lines from 1', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map((i) => autoLabel('x', i))).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ]);
    expect([0, 1, 9, 29].map((i) => autoLabel('y', i))).toEqual(['1', '2', '10', '30']);
  });

  it('builds an evenly spaced, automatically labelled grid that the schema accepts', () => {
    expect(labels(grid.xLines)).toEqual(['A', 'B', 'C', 'D']);
    expect(positions(grid.xLines)).toEqual([0, 6, 12, 18]);
    expect(labels(grid.yLines)).toEqual(['1', '2', '3', '4']);
    expect(positions(grid.yLines)).toEqual([0, 5, 10, 15]);
    expect(Grid.parse(grid)).toEqual(grid);
    expect(evenLines('x', 2, 0, 3)).toEqual([]);
  });

  it('treats an axis as automatic only while its labels follow position order', () => {
    expect(isAutoLabelled('x', grid.xLines)).toBe(true);
    expect(isAutoLabelled('x', [...grid.xLines].reverse())).toBe(true);
    expect(isAutoLabelled('x', [])).toBe(true);
    expect(isAutoLabelled('x', renameGridLine(grid, 'x', 1, 'B1').xLines)).toBe(false);
    expect(
      isAutoLabelled('y', [
        { label: '1', pos: 5 },
        { label: '2', pos: 0 },
      ]),
    ).toBe(false);
  });
});

describe('editing grid lines', () => {
  it('relabels an automatic axis when a line is added between others', () => {
    const next = addGridLine(grid, 'x', 9);
    expect(labels(next.xLines)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(positions(next.xLines)).toEqual([0, 6, 9, 12, 18]);
    expect(next.yLines).toBe(grid.yLines);
  });

  it('keeps custom labels and gives a new line the first unused automatic label', () => {
    const custom = renameGridLine(grid, 'x', 3, 'D1');
    const next = addGridLine(custom, 'x', 9);
    expect(labels(next.xLines)).toEqual(['A', 'B', 'D', 'C', 'D1']);
    expect(positions(next.xLines)).toEqual([0, 6, 9, 12, 18]);
  });

  it('adds the first line of an empty axis', () => {
    const next = addGridLine({ xLines: [], yLines: [] }, 'y', 3);
    expect(next.yLines).toEqual([{ label: '1', pos: 3 }]);
  });

  it('removes a line, relabelling only an automatic axis', () => {
    expect(labels(removeGridLine(grid, 'y', 1).yLines)).toEqual(['1', '2', '3']);
    expect(positions(removeGridLine(grid, 'y', 1).yLines)).toEqual([0, 10, 15]);
    const custom = renameGridLine(grid, 'y', 0, '0');
    expect(labels(removeGridLine(custom, 'y', 1).yLines)).toEqual(['0', '3', '4']);
  });

  it('moves a line past its neighbours, keeping the axis sorted', () => {
    const moved = moveGridLine(grid, 'x', 0, 14);
    expect(positions(moved.xLines)).toEqual([6, 12, 14, 18]);
    expect(labels(moved.xLines)).toEqual(['A', 'B', 'C', 'D']);

    const custom = renameGridLine(grid, 'x', 0, 'X');
    expect(labels(moveGridLine(custom, 'x', 0, 14).xLines)).toEqual(['B', 'C', 'X', 'D']);
  });

  it('renames a line by its index in position order and ignores a blank label', () => {
    const unsorted = { xLines: [...grid.xLines].reverse(), yLines: grid.yLines };
    expect(labels(renameGridLine(unsorted, 'x', 0, ' P ').xLines)).toEqual(['P', 'B', 'C', 'D']);
    expect(renameGridLine(grid, 'x', 0, '  ')).toBe(grid);
  });

  it('relabels one axis or both on request', () => {
    const custom = renameGridLine(renameGridLine(grid, 'x', 0, 'X'), 'y', 0, 'Y');
    expect(labels(relabelGrid(custom, 'x').xLines)).toEqual(['A', 'B', 'C', 'D']);
    expect(labels(relabelGrid(custom, 'x').yLines)).toEqual(['Y', '2', '3', '4']);
    expect(relabelGrid(custom)).toEqual(grid);
  });
});

describe('gridCell', () => {
  it('names a point by the nearest intersection', () => {
    expect(gridCell(grid, { x: 12, y: 15 })).toBe('C4');
    expect(gridCell(grid, { x: 13, y: 14 })).toBe('C4');
    // Between C and D and between 3 and 4, nearer D and 3.
    expect(gridCell(grid, { x: 16, y: 11 })).toBe('D3');
    expect(gridCell(grid, { x: 1, y: 9 })).toBe('A3');
  });

  it('names a point on a line by that line', () => {
    expect(gridCell(grid, { x: 6, y: 7 })).toBe('B2');
    expect(gridCell(grid, { x: 8, y: 10 })).toBe('B3');
  });

  it('gives a point halfway between two lines to the lower one', () => {
    expect(gridCell(grid, { x: 9, y: 7.5 })).toBe('B2');
  });

  it('reaches half the outer spacing beyond the outer lines, and is null further out', () => {
    expect(gridCell(grid, { x: -3, y: -2.5 })).toBe('A1');
    expect(gridCell(grid, { x: 21, y: 17.5 })).toBe('D4');
    expect(gridCell(grid, { x: -3.01, y: 0 })).toBeNull();
    expect(gridCell(grid, { x: 0, y: 17.6 })).toBeNull();
    expect(gridCell(grid, { x: 100, y: 100 })).toBeNull();
  });

  it('uses only the axis that has lines', () => {
    const xOnly = { xLines: grid.xLines, yLines: [] };
    const yOnly = { xLines: [], yLines: grid.yLines };
    expect(gridCell(xOnly, { x: 11, y: 1000 })).toBe('C');
    expect(gridCell(yOnly, { x: -1000, y: 4 })).toBe('2');
    expect(gridCell(xOnly, { x: 30, y: 0 })).toBeNull();
  });

  it('names every coordinate after a lone line on an axis', () => {
    const single = { xLines: [{ label: 'A', pos: 2 }], yLines: [{ label: '1', pos: 0 }] };
    expect(gridCell(single, { x: 2, y: 0 })).toBe('A1');
    expect(gridCell(single, { x: -50, y: 80 })).toBe('A1');
  });

  it('is null for an empty grid', () => {
    expect(gridCell({ xLines: [], yLines: [] }, { x: 0, y: 0 })).toBeNull();
  });

  it('accepts lines in any order and custom labels', () => {
    const custom = {
      xLines: [
        { label: 'K', pos: 10 },
        { label: 'J', pos: 0 },
      ],
      yLines: [
        { label: '20', pos: 4 },
        { label: '10', pos: -4 },
      ],
    };
    expect(gridCell(custom, { x: 7, y: -3 })).toBe('K10');
    expect(nearestGridLine(custom.xLines, 4)).toEqual({ label: 'J', pos: 0 });
    expect(nearestGridLine([], 4)).toBeNull();
  });
});

describe('setGrid', () => {
  it('replaces the grid whole and removes it when it has no lines', () => {
    const b = new ModelBuilder();
    const floorId = b.floors[0]!.id;
    const model = b.build();

    const added = applyEdit(model, setGrid(floorId, grid));
    expect(added.model.floors[floorId]!.data.grid).toEqual(grid);
    expect(splitByDocument(added.patches).get(floorId)).toEqual([
      { op: 'add', path: ['data', 'grid'], value: grid },
    ]);

    const moved = applyEdit(added.model, setGrid(floorId, moveGridLine(grid, 'x', 1, 7)));
    expect(moved.patches).toEqual([
      expect.objectContaining({ op: 'replace', path: ['floors', floorId, 'data', 'grid'] }),
    ]);

    const removed = applyEdit(moved.model, setGrid(floorId, { xLines: [], yLines: [] }));
    expect(removed.model.floors[floorId]!.data).not.toHaveProperty('grid');
    expect(applyEdit(removed.model, setGrid(floorId, null)).patches).toEqual([]);
  });
});
