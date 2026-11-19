import {
  gridLines,
  moveGridLine,
  setGrid,
  sortLines,
  type Grid,
  type GridAxis,
  type Id,
  type Pt,
} from '@el-karta/core';
import { Grid3x3 } from 'lucide-react';
import { createStore } from 'zustand/vanilla';
import { modelStore } from '@/model/store';
import type { CanvasPointer, Handle, Tool } from '../canvas/extension';

export const GRID_TOOL = 'grid';

const NO_GRID: Grid = { xLines: [], yLines: [] };

/** A grid line by its axis and its index in position order. */
export interface LineRef {
  axis: GridAxis;
  index: number;
}

export interface LineDrag extends LineRef {
  /** The line's position when the drag started. */
  from: number;
  /** The pointer's coordinate along the axis when the drag started. */
  start: number;
  pos: number;
}

interface GridUiState {
  /** Where the pointer is (or was last tapped) while the grid tool is active. */
  pointer: Pt | null;
  drag: LineDrag | null;
}

export const gridUiStore = createStore<GridUiState>()(() => ({ pointer: null, drag: null }));

const setPointer = (pointer: Pt | null) => {
  gridUiStore.setState({ pointer });
};

/** Applies `change` to the floor's grid (an empty one if it has none) as one undoable edit. */
export function editGrid(floorId: Id, change: (grid: Grid) => Grid | null) {
  const { model, apply } = modelStore.getState();
  const floor = model?.floors[floorId];
  if (!floor) return;
  const current = floor.data.grid ?? NO_GRID;
  const next = change(current);
  if (next !== current) apply(setGrid(floorId, next));
}

const toCentimetre = (v: number) => Math.round(v * 100) / 100;

const dragPos = (drag: LineDrag, p: CanvasPointer) =>
  toCentimetre(drag.from + p.world[drag.axis] - drag.start);

/** Moves a grid line by its end bubbles, keeping the grab offset; positions round to centimetres. */
export const gridLineHandle: Handle<LineRef & { from: number }> = {
  name: 'grid-line',
  onDragStart: ({ axis, index, from }, start) => {
    gridUiStore.setState({
      drag: { axis, index, from, start: start.world[axis], pos: from },
    });
  },
  onDrag: (_payload, p) => {
    const { drag } = gridUiStore.getState();
    if (drag) gridUiStore.setState({ drag: { ...drag, pos: dragPos(drag, p) } });
  },
  onDragEnd: (_payload, p, ctx) => {
    const { drag } = gridUiStore.getState();
    gridUiStore.setState({ drag: null });
    if (!drag) return;
    const pos = dragPos(drag, p);
    if (pos !== drag.from) {
      editGrid(ctx.floorId, (grid) =>
        // The grid may have changed during the drag (undo, a merged remote save); never move another line.
        sortLines(gridLines(grid, drag.axis))[drag.index]?.pos === drag.from
          ? moveGridLine(grid, drag.axis, drag.index, pos)
          : grid,
      );
    }
  },
  onDragCancel: () => {
    gridUiStore.setState({ drag: null });
  },
};

/** Shows the grid panel and the grid location under the pointer; line bubbles become draggable. */
export const gridTool: Tool = {
  id: GRID_TOOL,
  label: 'grid.tool',
  icon: Grid3x3,
  order: 70,
  shortcut: 'g',
  onHover: (p) => {
    setPointer(p.world);
  },
  // Touch has no hover, so a tap shows the location under the finger.
  onTap: (p) => {
    setPointer(p.world);
  },
  onLeave: () => {
    setPointer(null);
  },
  onDeactivate: () => {
    setPointer(null);
  },
};
