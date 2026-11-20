import { moveVertex, polygonProblem, samePolygon, type Id } from '@el-karta/core';
import type { CanvasContext, CanvasPointer, Handle } from '../canvas/extension';
import {
  areaOf,
  checkPolygon,
  polygonMessage,
  reshapePolygon,
  updateArea,
  type AreaCollection,
  type Reshape,
} from './area-edits';
import { snapTolerance } from '../snapping/snapping';
import { snapForArea } from './area-tools';
import { areasUiStore, clearNotice, showNotice } from './areas-ui-store';

export interface AreaHandlePayload {
  collection: AreaCollection;
  id: Id;
  index: number;
}

/**
 * The reshaped polygon under the pointer, snapped to everything but the polygon itself, with angle
 * steps from the corners the dragged one connects to.
 */
function reshaped(
  { collection, id, index }: AreaHandlePayload,
  kind: Reshape['kind'],
  p: CanvasPointer,
  ctx: CanvasContext,
) {
  const area = areaOf(ctx.floorId, collection, id);
  if (!area) return null;
  const n = area.polygon.length;
  const from =
    kind === 'move'
      ? [area.polygon[(index - 1 + n) % n]!, area.polygon[(index + 1) % n]!]
      : [area.polygon[index]!, area.polygon[(index + 1) % n]!];
  const snap = snapForArea(p, ctx, { ignore: id, from });
  const mergeTolerance = kind === 'move' ? snapTolerance(p, ctx) : 0;
  const polygon = reshapePolygon(area.polygon, { kind, index }, snap.point, mergeTolerance);
  // With too few corners left to remove one, the preview keeps it under the pointer.
  const preview = polygon ?? moveVertex(area.polygon, index, snap.point);
  return { area, snap, polygon, preview };
}

/** One undo step per drag: the preview lives in the areas UI store until the drag ends. */
function reshapeHandle(name: string, kind: Reshape['kind']): Handle<AreaHandlePayload> {
  return {
    name,
    onDrag: (payload, p, ctx) => {
      const result = reshaped(payload, kind, p, ctx);
      if (!result) return;
      clearNotice();
      areasUiStore.setState({
        snap: result.snap,
        drag: { collection: payload.collection, id: payload.id, polygon: result.preview },
      });
    },
    onDragEnd: (payload, p, ctx) => {
      const result = reshaped(payload, kind, p, ctx);
      areasUiStore.setState({ drag: null, snap: null });
      if (!result) return;
      const { area, polygon } = result;
      const check = checkPolygon(polygon);
      // An outline that is already broken may take several drags to mend, so only a valid one is guarded.
      const guarded = polygonProblem(area.polygon) === null;
      if (!check.ok && (guarded || !polygon)) {
        showNotice(polygonMessage(payload.collection, check.problem));
        return;
      }
      const next = polygon ?? area.polygon;
      if (samePolygon(next, area.polygon)) return;
      updateArea(ctx.floorId, payload.collection, payload.id, (item) => ({
        ...item,
        polygon: next,
      }));
    },
    onDragCancel: () => {
      areasUiStore.setState({ drag: null, snap: null });
    },
  };
}

export const vertexHandle = reshapeHandle('area-vertex', 'move');
export const midpointHandle = reshapeHandle('area-midpoint', 'insert');
