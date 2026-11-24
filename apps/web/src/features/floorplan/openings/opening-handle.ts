import { EPSILON, offsetAlong, putSpaceItem, type Id, type Opening } from '@el-karta/core';
import { modelStore } from '@/model/store';
import type { CanvasContext, CanvasPointer, Handle } from '../canvas/extension';
import { snappingStore } from '../snapping/snapping';
import { openingsStore } from './openings-store';
import {
  moveOpeningEdge,
  openingFrame,
  slideOpeningTo,
  type OpeningEdge,
  type OpeningFrame,
} from './resize';

const floorOf = (floorId: Id) => modelStore.getState().model?.floors[floorId];

const changed = (a: Opening, b: Opening) =>
  Math.abs(a.offset - b.offset) > EPSILON || Math.abs(a.width - b.width) > EPSILON;

const rounds = (p: CanvasPointer) => snappingStore.getState().enabled && !p.altKey;

interface OpeningDragSpec<P extends { id: Id }> {
  name: string;
  /** Metres from the wall's end `a` to the part of the opening that follows the pointer. */
  anchor: (opening: Opening, payload: P) => number;
  /** The opening with that part moved to `at` metres from the wall's end `a`, or null. */
  move: (
    frame: OpeningFrame,
    opening: Opening,
    payload: P,
    at: number,
    round: boolean,
  ) => Opening | null;
}

/**
 * A handle that changes one opening along its wall: the part at `anchor` follows the pointer, kept
 * where it was grabbed. The opening is drawn from the store while dragged, and the drop is one
 * undoable edit.
 */
function openingDragHandle<P extends { id: Id }>(spec: OpeningDragSpec<P>): Handle<P> {
  const target = (payload: P, p: CanvasPointer, ctx: CanvasContext) => {
    const drag = openingsStore.getState().drag;
    const floor = floorOf(ctx.floorId);
    const opening = floor?.data.openings[payload.id];
    const frame = opening && openingFrame(floor.data, opening);
    if (!opening || !frame || drag?.floorId !== ctx.floorId || drag.id !== payload.id) return null;
    const at = offsetAlong(frame.wall, p.world) - drag.grab;
    return { drag, opening, moved: spec.move(frame, opening, payload, at, rounds(p)) ?? opening };
  };
  const stop = () => {
    openingsStore.setState({ drag: null });
  };
  return {
    name: spec.name,
    onDragStart: (payload, start, _p, ctx) => {
      const floor = floorOf(ctx.floorId);
      const opening = floor?.data.openings[payload.id];
      const wall = opening && floor.data.walls[opening.wallId];
      if (!opening || !wall) return;
      openingsStore.setState({
        drag: {
          floorId: ctx.floorId,
          id: payload.id,
          grab: offsetAlong(wall, start.world) - spec.anchor(opening, payload),
          opening,
        },
      });
    },
    onDrag: (payload, p, ctx) => {
      const t = target(payload, p, ctx);
      if (t) openingsStore.setState({ drag: { ...t.drag, opening: t.moved } });
    },
    onDragEnd: (payload, p, ctx) => {
      const t = target(payload, p, ctx);
      stop();
      if (t && changed(t.opening, t.moved))
        modelStore.getState().apply(putSpaceItem(ctx.floorId, 'openings', t.moved));
    },
    onDragCancel: stop,
  };
}

/**
 * An opening, dragged along its own wall. It stays within the wall's ends and is nudged beside
 * other openings rather than over them.
 */
export const openingSlide = openingDragHandle<{ id: Id }>({
  name: 'opening-slide',
  anchor: (opening) => opening.offset,
  move: (frame, opening, _payload, at, round) => slideOpeningTo(frame, opening, at, round),
});

const edgeAt = (opening: Opening, edge: OpeningEdge) =>
  edge === 'start' ? opening.offset : opening.offset + opening.width;

/** One edge of a selected opening, dragged along the wall to change its width from that side. */
export const openingEdgeHandle = openingDragHandle<{ id: Id; edge: OpeningEdge }>({
  name: 'opening-edge',
  anchor: (opening, { edge }) => edgeAt(opening, edge),
  move: (frame, opening, { edge }, at, round) => moveOpeningEdge(frame, opening, edge, at, round),
});
