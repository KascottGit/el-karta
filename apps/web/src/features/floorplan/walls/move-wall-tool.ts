import { MoveHorizontal } from 'lucide-react';
import { selectTool } from '../canvas/base-extension';
import type { Tool } from '../canvas/extension';
import { DEFAULT_TOOL, type EditorState } from '../editor-store';
import { cancelWallMove, dragWallMove, endWallMove, startWallMove } from './move-wall-handle';

export const MOVE_WALL_TOOL = 'move-wall';

/**
 * Whether a selected wall can be moved by dragging its body or arrow: it is the only selected item,
 * the select or move-wall tool is active and nothing is drawn.
 */
export const wallsMovable = (s: EditorState) =>
  s.selection.length === 1 &&
  s.drawing === null &&
  (s.tool === DEFAULT_TOOL || s.tool === MOVE_WALL_TOOL);

/**
 * Moves any wall it is dragged on along the wall's normal, without selecting it first; a drag that
 * starts off a wall pans. A drag on a door, window or passage still slides it along its wall,
 * since handles take drags before any tool. A tap selects, as with the select tool.
 */
export const moveWallTool: Tool = {
  id: MOVE_WALL_TOOL,
  label: 'walls.moveTool',
  icon: MoveHorizontal,
  order: 11,
  shortcut: 'o',
  cursor: 'move',
  onTap: (p, ctx) => {
    selectTool.onTap?.(p, ctx);
  },
  onDragStart: (start, p, ctx) => {
    const hit = ctx.itemAt(start.screen, start.kind);
    if (hit?.collection !== 'walls' || !startWallMove(hit.id, start, ctx)) return false;
    dragWallMove(p, ctx);
    return true;
  },
  onDrag: dragWallMove,
  onDragEnd: endWallMove,
  onDragCancel: cancelWallMove,
  onDeactivate: cancelWallMove,
};
