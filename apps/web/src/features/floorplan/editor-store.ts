import type { Id, Pt } from '@el-karta/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { SelectionItem } from './canvas/selection';
import {
  fitRect,
  nextRenderWindow,
  type RenderWindow,
  type Size,
  type Viewport,
} from './canvas/viewport';
import type { Rect } from './canvas/rect';

export const DEFAULT_TOOL = 'select';

/**
 * A polyline or polygon being drawn by the active tool: the points placed so far and the (snapped)
 * pointer position. Cleared on tool switch, floor switch and Escape. Tools that need other preview
 * state (a snap marker, a wall id and offset) keep it in their own store and reset it in
 * `Tool.onDeactivate`. A tool may commit the points in `onDeactivate` instead of discarding them,
 * as the wall tool does on Escape, tool switch and floor switch.
 */
export interface Drawing {
  points: readonly Pt[];
  hover: Pt | null;
}

/** UI state of the floor editor. It never enters undo/redo or saving; model changes go through the model store. */
export interface EditorState {
  floorId: Id | null;
  tool: string;
  selection: readonly SelectionItem[];
  viewport: Viewport;
  /** Size of the canvas in CSS pixels; zero until it is first measured. */
  size: Size;
  /** Updated only when the view leaves it, so renderers that cull by it re-render rarely. */
  renderWindow: RenderWindow;
  /**
   * The bounds of the last zoom to fit, so a resize while the page settles can refit them. Cleared
   * once the person moves the view, selects or picks a tool, so a side panel opening then does not
   * refit the view under them.
   */
  fitted: { bounds: Rect | null } | null;
  drawing: Drawing | null;
  /** Clears selection and drawing for another floor. The viewport stays, since floors are stacked. */
  openFloor: (floorId: Id) => void;
  setTool: (tool: string) => void;
  select: (items: readonly SelectionItem[]) => void;
  setViewport: (viewport: Viewport) => void;
  setSize: (size: Size) => void;
  fit: (bounds: Rect | null) => void;
  setDrawing: (drawing: Drawing | null) => void;
}

const INITIAL_VIEWPORT: Viewport = { x: 0, y: 0, scale: 40 };
const NO_SIZE: Size = { width: 0, height: 0 };

export function createEditorStore() {
  return createStore<EditorState>()((set, get) => {
    const view = (viewport: Viewport, size = get().size, jump = false) => ({
      viewport,
      renderWindow: nextRenderWindow(jump ? null : get().renderWindow, viewport, size),
    });

    return {
      floorId: null,
      tool: DEFAULT_TOOL,
      selection: [],
      viewport: INITIAL_VIEWPORT,
      size: NO_SIZE,
      renderWindow: nextRenderWindow(null, INITIAL_VIEWPORT, NO_SIZE),
      fitted: null,
      drawing: null,

      openFloor: (floorId) => {
        if (get().floorId !== floorId) set({ floorId, selection: [], drawing: null });
      },
      setTool: (tool) => {
        set({ tool, drawing: null, fitted: null });
      },
      select: (selection) => {
        set({ selection, fitted: null });
      },
      setViewport: (viewport) => {
        set({ ...view(viewport), fitted: null });
      },
      setSize: (size) => {
        const { fitted, viewport } = get();
        set({
          size,
          ...(fitted ? view(fitRect(fitted.bounds, size), size, true) : view(viewport, size)),
        });
      },
      fit: (bounds) => {
        set({ ...view(fitRect(bounds, get().size), get().size, true), fitted: { bounds } });
      },
      setDrawing: (drawing) => {
        set({ drawing });
      },
    };
  });
}

export type EditorStore = ReturnType<typeof createEditorStore>;

export const editorStore = createEditorStore();

export const useEditorStore = <T>(selector: (state: EditorState) => T): T =>
  useStore(editorStore, selector);
