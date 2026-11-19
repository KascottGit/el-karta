import {
  centroid,
  gridCell,
  pointOnWall,
  resolvePlacement,
  type FloorData,
  type Grid,
  type Pt,
} from '@el-karta/core';
import type { SelectionItem } from '../canvas/selection';

/** The point that stands for an item when naming its grid location; null for connections. */
export function itemAnchor(data: FloorData, { collection, id }: SelectionItem): Pt | null {
  switch (collection) {
    case 'walls': {
      const wall = data.walls[id];
      return wall ? { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 } : null;
    }
    case 'openings': {
      const opening = data.openings[id];
      const wall = opening && data.walls[opening.wallId];
      return opening && wall ? pointOnWall(wall, opening.offset + opening.width / 2) : null;
    }
    case 'rooms':
    case 'zones': {
      const area = data[collection][id];
      return area && area.polygon.length > 0 ? centroid(area.polygon) : null;
    }
    case 'devices': {
      const device = data.devices[id];
      if (!device) return null;
      const placed = resolvePlacement(data, device);
      const at = placed.ok ? placed.position : placed.approximate;
      return at ? { x: at.x, y: at.y } : null;
    }
    case 'connections':
      return null;
  }
}

/** The distinct grid locations of the selected items, in selection order. */
export function selectionCells(
  data: FloorData,
  grid: Grid,
  selection: readonly SelectionItem[],
): string[] {
  const cells = new Set<string>();
  for (const item of selection) {
    const at = itemAnchor(data, item);
    const cell = at && gridCell(grid, at);
    if (cell) cells.add(cell);
  }
  return [...cells];
}
