import type { Id } from '@el-karta/core';
import { useMemo } from 'react';
import { useModelStore } from '@/model/store';
import { contentBounds, gridExtent } from './extent';

/** The area the floor's walls, rooms and zones cover, recomputed only when they change. */
export function useContentBounds(floorId: Id) {
  const walls = useModelStore((s) => s.model?.floors[floorId]?.data.walls);
  const rooms = useModelStore((s) => s.model?.floors[floorId]?.data.rooms);
  const zones = useModelStore((s) => s.model?.floors[floorId]?.data.zones);
  return useMemo(
    () => (walls && rooms && zones ? contentBounds({ walls, rooms, zones }) : null),
    [walls, rooms, zones],
  );
}

/** The floor's grid and the area its lines span. */
export function useGridGeometry(floorId: Id) {
  const grid = useModelStore((s) => s.model?.floors[floorId]?.data.grid);
  const content = useContentBounds(floorId);
  const extent = useMemo(() => grid && gridExtent(grid, content), [grid, content]);
  return { grid, extent };
}
