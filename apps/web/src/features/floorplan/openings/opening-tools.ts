import { nearestWall, putSpaceItem, type Id } from '@el-karta/core';
import { AppWindow, DoorOpen, SquareDashed, type LucideIcon } from 'lucide-react';
import { modelStore } from '@/model/store';
import { editorStore } from '../editor-store';
import type { CanvasContext, CanvasPointer, MessageKey, Tool } from '../canvas/extension';
import { snapTolerance } from '../walls/snapping';
import { openingsStore } from './openings-store';
import { OPENING_DEFAULTS, placeOpening, type OpeningKind, type Placement } from './placement';

const PREVIEW_ID = 'opening-preview';

const NOTICES: Readonly<Record<Exclude<Placement, { ok: true }>['reason'], MessageKey>> = {
  'too-short': 'openings.tooShort',
  'no-room': 'openings.noRoom',
};

/** Where an opening of `kind` would go for this pointer: on the nearest wall within reach, or null. */
function placementAt(kind: OpeningKind, p: CanvasPointer, ctx: CanvasContext, id: Id) {
  const floor = modelStore.getState().model?.floors[ctx.floorId];
  const hit = floor && nearestWall(floor.data, p.world, snapTolerance(p, ctx));
  return hit ? placeOpening(floor.data, kind, hit, OPENING_DEFAULTS[kind], id) : null;
}

const onOpening = (p: CanvasPointer, ctx: CanvasContext) => {
  const item = ctx.itemAt(p.screen, p.kind);
  return item?.collection === 'openings' ? item : null;
};

const clearPreview = () => {
  openingsStore.setState({ preview: null });
};

/**
 * Places a door, window or passage on the wall nearest a click or tap, centred there and kept on
 * the wall and off other openings. A hover shows where it would go. A tap on an existing opening
 * selects it instead.
 */
function openingTool(
  kind: OpeningKind,
  spec: Pick<Tool, 'label' | 'order' | 'shortcut'> & { icon: LucideIcon },
): Tool {
  return {
    id: kind,
    ...spec,
    cursor: 'crosshair',
    onHover: (p, ctx) => {
      const placement = onOpening(p, ctx) ? null : placementAt(kind, p, ctx, PREVIEW_ID);
      openingsStore.setState({
        preview: placement?.ok ? { floorId: ctx.floorId, opening: placement.opening } : null,
      });
    },
    onTap: (p, ctx) => {
      const existing = onOpening(p, ctx);
      if (existing) {
        editorStore.getState().select([existing]);
        return;
      }
      const placement = placementAt(kind, p, ctx, crypto.randomUUID());
      if (!placement) {
        openingsStore.setState({ notice: 'openings.notOnWall' });
        return;
      }
      if (!placement.ok) {
        openingsStore.setState({ notice: NOTICES[placement.reason] });
        return;
      }
      openingsStore.setState({ notice: null, preview: null });
      modelStore.getState().apply(putSpaceItem(ctx.floorId, 'openings', placement.opening));
    },
    onLeave: clearPreview,
    onDeactivate: () => {
      openingsStore.setState({ preview: null, notice: null });
    },
  };
}

export const doorTool = openingTool('door', {
  label: 'openings.kinds.door',
  icon: DoorOpen,
  order: 20,
  shortcut: 'd',
});

export const windowTool = openingTool('window', {
  label: 'openings.kinds.window',
  icon: AppWindow,
  order: 21,
  shortcut: 'n',
});

export const passageTool = openingTool('passage', {
  label: 'openings.kinds.passage',
  icon: SquareDashed,
  order: 22,
  shortcut: 'p',
});

export const OPENING_TOOLS: readonly Tool[] = [doorTool, windowTool, passageTool];

export const isOpeningTool = (toolId: string): toolId is OpeningKind =>
  OPENING_TOOLS.some((t) => t.id === toolId);
