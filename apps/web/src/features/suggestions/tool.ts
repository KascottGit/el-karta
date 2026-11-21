import { Sparkles } from 'lucide-react';
import type { Tool } from '@/features/floorplan/canvas/extension';
import { TOUCH_RADIUS } from '@/features/floorplan/canvas/hit';
import { ghostAt } from './ghosts';
import { onFloor, selectSuggestion, suggestionsStore } from './suggestions-store';

export const SUGGESTIONS_TOOL = 'suggestions';

const MOUSE_REACH_PX = 4;

/**
 * Reviews the floor's suggestions: shows the suggestions panel, and a tap on a ghost selects that
 * suggestion there. Ghosts are not model items, so they are hit-tested here rather than through
 * the canvas's `selectable` nodes.
 */
export const suggestionsTool: Tool = {
  id: SUGGESTIONS_TOOL,
  label: 'suggestions.tool',
  icon: Sparkles,
  order: 95,
  shortcut: 'a',
  onTap: (p, ctx) => {
    const ghosts = onFloor(suggestionsStore.getState().ghosts, ctx.floorId) ?? {};
    const reach = ctx.pxToWorld(p.kind === 'touch' ? TOUCH_RADIUS : MOUSE_REACH_PX);
    const hit = ghostAt(Object.values(ghosts), p.world, reach);
    selectSuggestion(ctx.floorId, hit?.suggestion.id ?? null);
  },
  onKeyDown: (e, ctx) => {
    if (e.key !== 'Escape' || onFloor(suggestionsStore.getState().selected, ctx.floorId) === null) {
      return false;
    }
    selectSuggestion(ctx.floorId, null);
    return true;
  },
  onDeactivate: (ctx) => {
    selectSuggestion(ctx.floorId, null);
  },
};
