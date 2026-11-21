import {
  imageToWorld,
  type BackgroundPlacement,
  type FloorRecord,
  type Id,
  type Pt,
} from '@el-karta/core';
import { ImageIcon, Ruler } from 'lucide-react';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import type { CanvasContext, Handle, Tool } from '../canvas/extension';
import { worldToScreen, zoomAt } from '../canvas/viewport';
import { backgroundUi } from './background-store';
import { readyImageSize } from './images';
import { imageCenter } from './plan-file';
import { rescaleOffer, type RescaleOffer } from './rescale';
import { emitScaleMeasured } from './scale-events';
import { measuredScale, normalizeDegrees, placeBackground, rotatedAboutCenter } from './placement';
import { cancelUpload } from './upload';

export const BACKGROUND_TOOL = 'background';
export const SCALE_TOOL = 'scale';

const floorOf = (floorId: Id): FloorRecord | undefined =>
  modelStore.getState().model?.floors[floorId];

/** Shows the background panel and the move and rotate handles. Drags elsewhere pan as usual. */
export const backgroundTool: Tool = {
  id: BACKGROUND_TOOL,
  label: 'background.tool',
  icon: ImageIcon,
  order: 90,
  shortcut: 'b',
  // Tool switch, Escape and floor switch close the page picker and free the PDF.
  onDeactivate: () => {
    cancelUpload();
  },
};

/** Two taps on the image, then the real length in the panel. The points are handles, to fine-tune them. */
export const scaleTool: Tool = {
  id: SCALE_TOOL,
  label: 'background.scaleTool',
  icon: Ruler,
  order: 91,
  shortcut: 'm',
  cursor: 'crosshair',
  onHover: (p, ctx) => {
    const { drawing, setDrawing } = editorStore.getState();
    if (drawing?.points.length === 1 && floorOf(ctx.floorId)?.data.background)
      setDrawing({ points: drawing.points, hover: p.world });
  },
  onTap: (p, ctx) => {
    if (!floorOf(ctx.floorId)?.data.background) return;
    const { drawing, setDrawing } = editorStore.getState();
    const points = drawing?.points ?? [];
    // A tap on a measurement end is the start of fine-tuning it, not a new measurement.
    if (p.onHandle && points.length === 2) return;
    setDrawing({
      points: points.length === 1 ? [points[0]!, p.world] : [p.world],
      hover: null,
    });
  },
  onLeave: () => {
    const { drawing, setDrawing } = editorStore.getState();
    if (drawing?.hover) setDrawing({ points: drawing.points, hover: null });
  },
};

/**
 * Sets the floor's scale from the measurement drawn with the scale tool. The view zooms with the
 * image, so it stays steady on screen. Returns null if the measurement cannot be used, else an
 * offer to rescale what is drawn on the floor, if anything is.
 */
export function applyMeasuredScale(
  ctx: CanvasContext,
  metres: number,
): { rescale: RescaleOffer | null } | null {
  const floor = floorOf(ctx.floorId);
  const { drawing, viewport, setViewport, setDrawing } = editorStore.getState();
  const [a, b] = drawing?.points ?? [];
  if (!floor || !a || !b) return null;
  const measured = measuredScale(ctx.floorId, floor.data, a, b, metres);
  if (!measured) return null;
  modelStore.getState().apply(measured.edit);
  setDrawing(null);
  setViewport(zoomAt(viewport, worldToScreen(viewport, measured.pivot), 1 / measured.growth));
  emitScaleMeasured({
    floorId: ctx.floorId,
    scale: { source: 'user', metresPerPixel: measured.metresPerPixel },
    growth: measured.growth,
    pivot: measured.pivot,
  });
  return { rescale: rescaleOffer(ctx.floorId, floor.data, measured) };
}

export interface PlacementPayload {
  floorId: Id;
  placement: BackgroundPlacement;
}

const setDraft = (floorId: Id, placement: BackgroundPlacement | null) => {
  backgroundUi.setState({ draft: placement && { floorId, placement } });
};

function commitDraft(floorId: Id) {
  const draft = backgroundUi.getState().draft;
  const floor = floorOf(floorId);
  setDraft(floorId, null);
  if (!draft || draft.floorId !== floorId || !floor) return;
  const edit = placeBackground(floorId, floor.data, draft.placement);
  if (edit) modelStore.getState().apply(edit);
}

let grabbedAt: Pt = { x: 0, y: 0 };

export const moveHandle: Handle<PlacementPayload> = {
  name: 'background-move',
  onDragStart: (_payload, start) => {
    grabbedAt = start.world;
  },
  onDrag: ({ floorId, placement }, p) => {
    setDraft(floorId, {
      ...placement,
      offset: {
        x: placement.offset.x + p.world.x - grabbedAt.x,
        y: placement.offset.y + p.world.y - grabbedAt.y,
      },
    });
  },
  onDragEnd: ({ floorId }) => {
    commitDraft(floorId);
  },
  onDragCancel: ({ floorId }) => {
    setDraft(floorId, null);
  },
};

const ROTATION_SNAP_DEGREES = 15;
const angleTo = (from: Pt, to: Pt) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

/** Turns the image about its centre; Shift snaps to 15° steps. */
export const rotateHandle: Handle<PlacementPayload & { attachmentId: Id }> = {
  name: 'background-rotate',
  onDragStart: (_payload, start) => {
    grabbedAt = start.world;
  },
  onDrag: ({ floorId, placement, attachmentId }, p) => {
    const size = readyImageSize(attachmentId);
    if (!size) return;
    const pivot = imageToWorld(placement, imageCenter(size));
    let rotation = placement.rotation + angleTo(pivot, p.world) - angleTo(pivot, grabbedAt);
    rotation = p.shiftKey
      ? Math.round(rotation / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES
      : Math.round(rotation * 10) / 10;
    setDraft(floorId, rotatedAboutCenter(placement, normalizeDegrees(rotation), size));
  },
  onDragEnd: ({ floorId }) => {
    commitDraft(floorId);
  },
  onDragCancel: ({ floorId }) => {
    setDraft(floorId, null);
  },
};

let measuredFrom: Pt | null = null;

/** Fine-tunes one end of a scale measurement. */
export const measureEndHandle: Handle<{ index: 0 | 1 }> = {
  name: 'scale-measure-end',
  onDragStart: ({ index }) => {
    measuredFrom = editorStore.getState().drawing?.points[index] ?? null;
  },
  onDrag: ({ index }, p) => {
    moveMeasureEnd(index, p.world);
  },
  onDragCancel: ({ index }) => {
    if (measuredFrom) moveMeasureEnd(index, measuredFrom);
  },
};

function moveMeasureEnd(index: 0 | 1, to: Pt) {
  const { drawing, setDrawing } = editorStore.getState();
  if (!drawing || drawing.points.length !== 2) return;
  const points = [...drawing.points];
  points[index] = to;
  setDrawing({ points, hover: null });
}
