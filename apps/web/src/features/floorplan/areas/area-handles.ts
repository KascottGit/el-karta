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
import { snapForArea, snapTolerance } from './area-tools';
import { areasUiStore, showNotice } from './areas-ui-store';

export interface AreaHandlePayload {
  collection: AreaCollection;
  id: Id;
  index: number;
}

/** The reshaped polygon under the pointer, snapped to everything but the polygon itself. */
function reshaped(
  { collection, id, index }: AreaHandlePayload,
  kind: Reshape['kind'],
  p: CanvasPointer,
  ctx: CanvasContext,
) {
  const area = areaOf(ctx.floorId, collection, id);
  if (!area) return null;
  const snap = snapForArea(p, ctx, { ignore: id });
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
      areasUiStore.setState({
        snap: result.snap.snapped ? result.snap.point : null,
        notice: null,
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
        showNotice(result.snap.point, polygonMessage(payload.collection, check.problem));
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
