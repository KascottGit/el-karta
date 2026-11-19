import type { FloorRecord, Id, Pt } from '@el-karta/core';
import type { ParseKeys } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ModelState } from '@/model/store';
import { DEFAULT_TOOL, type EditorState } from '../editor-store';
import type { PointerKind } from './gestures';
import type { Rect } from './rect';
import type { SelectionItem } from './selection';

/** Drawing order, bottom first. Each extension's layer content goes into one of these. */
export const CANVAS_LAYERS = [
  'background',
  'grid',
  'areas',
  'walls',
  'openings',
  'overlays',
] as const;
export type CanvasLayer = (typeof CANVAS_LAYERS)[number];

export type MessageKey = ParseKeys;

/** What tools, actions, panels and layer content get to talk to the canvas. */
export interface CanvasContext {
  floorId: Id;
  /**
   * The topmost selectable shape at a screen point (see `selectable` in `hit.ts`). For touch it
   * also searches a finger-sized radius around the point.
   */
  itemAt(screen: Pt, kind?: PointerKind): SelectionItem | null;
  /** Converts a distance in screen pixels to metres at the current zoom, for snap and hit tolerances. */
  pxToWorld(px: number): number;
  zoomToFit(): void;
}

export interface CanvasPointer {
  /** Plan coordinates in metres. */
  world: Pt;
  /** Pixels from the canvas's top-left corner. */
  screen: Pt;
  kind: PointerKind;
  shiftKey: boolean;
  altKey: boolean;
  /** Ctrl, or Cmd on a Mac. */
  modKey: boolean;
  /** The press started on a handle. Its drag goes to the handle; a tap still reaches the tool. */
  onHandle: boolean;
}

/**
 * A modal tool with a toolbar button. The canvas turns pointer input into these calls; a drag the
 * tool does not take (no `onDragStart`, or it returns false) pans the view instead.
 */
export interface Tool {
  id: string;
  label: MessageKey;
  icon: LucideIcon;
  /** Position in the toolbar, lowest first. */
  order: number;
  /** A single lower-case key that activates the tool. */
  shortcut?: string;
  cursor?: string;
  onHover?(p: CanvasPointer, ctx: CanvasContext): void;
  /** A click or tap. */
  onTap?(p: CanvasPointer, ctx: CanvasContext): void;
  /** Replaces the second `onTap` of a double click or double tap; falls back to `onTap`. */
  onDoubleTap?(p: CanvasPointer, ctx: CanvasContext): void;
  onDragStart?(start: CanvasPointer, p: CanvasPointer, ctx: CanvasContext): boolean;
  onDrag?(p: CanvasPointer, ctx: CanvasContext): void;
  onDragEnd?(p: CanvasPointer, ctx: CanvasContext): void;
  onDragCancel?(ctx: CanvasContext): void;
  /** Sees every key press first while the tool is active; returning true stops the default handling. */
  onKeyDown?(e: KeyboardEvent, ctx: CanvasContext): boolean;
  /** The pointer left the canvas; hide hover previews. */
  onLeave?(ctx: CanvasContext): void;
  /**
   * Reset any preview state the tool keeps outside the editor store's `drawing`. Called before the
   * tool is switched away from and on Escape.
   */
  onDeactivate?(ctx: CanvasContext): void;
}

/**
 * A draggable point such as a wall end or a polygon vertex. Draw it with the `handle(spec, payload)`
 * props from `hit.ts`; a drag that starts on it comes here instead of to the active tool, whatever
 * the tool. Do not use Konva's `draggable`.
 */
export interface Handle<P = unknown> {
  name: string;
  onDragStart?(payload: P, start: CanvasPointer, p: CanvasPointer, ctx: CanvasContext): void;
  onDrag(payload: P, p: CanvasPointer, ctx: CanvasContext): void;
  onDragEnd?(payload: P, p: CanvasPointer, ctx: CanvasContext): void;
  /** Escape, a second finger or leaving the editor: undo any preview. */
  onDragCancel?(payload: P, ctx: CanvasContext): void;
}

/** A one-shot toolbar button, such as undo or zoom to fit. */
export interface Action {
  id: string;
  label: MessageKey;
  icon: LucideIcon;
  order: number;
  shortcut?: string;
  enabled?(editor: EditorState, model: ModelState): boolean;
  run(ctx: CanvasContext): void;
}

/** Konva nodes drawn into one of the canvas layers, in world coordinates. */
export interface LayerContent {
  id: string;
  layer: CanvasLayer;
  /** Position within the layer, lowest drawn first. */
  order: number;
  Component: ComponentType<{ ctx: CanvasContext }>;
  /** The world area this content covers on a floor, for zoom to fit. */
  bounds?(floor: FloorRecord): Rect | null;
}

/** A section of the side panel, shown while `visible` holds. */
export interface Panel {
  id: string;
  order: number;
  visible(editor: EditorState, model: ModelState): boolean;
  Component: ComponentType<{ ctx: CanvasContext }>;
}

/** Everything one feature folder adds to the editor. Registered in `features/floorplan/extensions.ts`. */
export interface EditorExtension {
  id: string;
  tools?: readonly Tool[];
  actions?: readonly Action[];
  layers?: readonly LayerContent[];
  panels?: readonly Panel[];
  // A `never` payload accepts handles of any payload type.
  handles?: readonly Handle<never>[];
}

export interface ResolvedExtensions {
  tools: readonly Tool[];
  actions: readonly Action[];
  layers: Readonly<Record<CanvasLayer, readonly LayerContent[]>>;
  panels: readonly Panel[];
  handles: ReadonlyMap<string, Handle<never>>;
  /** The tool with this id, or the default tool if there is none. */
  tool(id: string): Tool;
  shortcuts: { tools: ReadonlyMap<string, string>; actions: ReadonlyMap<string, string> };
}

const byOrder = <T extends { order: number }>(items: T[]) =>
  items.sort((a, b) => a.order - b.order);

function uniqueIds(kind: string, items: readonly { id: string }[]) {
  const seen = new Set<string>();
  for (const { id } of items) {
    if (seen.has(id)) throw new Error(`Duplicate editor ${kind} id "${id}"`);
    seen.add(id);
  }
}

function shortcutMap(items: readonly { id: string; shortcut?: string }[], taken: Set<string>) {
  const map = new Map<string, string>();
  for (const { id, shortcut } of items) {
    if (shortcut === undefined) continue;
    if (taken.has(shortcut)) throw new Error(`Shortcut "${shortcut}" is used twice`);
    taken.add(shortcut);
    map.set(shortcut, id);
  }
  return map;
}

/** Merges and orders the registered extensions, failing fast on clashing ids or shortcuts. */
export function resolveExtensions(extensions: readonly EditorExtension[]): ResolvedExtensions {
  uniqueIds('extension', extensions);
  const tools = byOrder(extensions.flatMap((e) => e.tools ?? []));
  const actions = byOrder(extensions.flatMap((e) => e.actions ?? []));
  const content = byOrder(extensions.flatMap((e) => e.layers ?? []));
  const panels = byOrder(extensions.flatMap((e) => e.panels ?? []));
  const handles = extensions.flatMap((e) => e.handles ?? []);
  uniqueIds('tool', tools);
  uniqueIds('action', actions);
  uniqueIds('layer content', content);
  uniqueIds('panel', panels);
  uniqueIds(
    'handle',
    handles.map((h) => ({ id: h.name })),
  );

  const fallback = tools.find((t) => t.id === DEFAULT_TOOL);
  if (!fallback) throw new Error(`No tool with the default id "${DEFAULT_TOOL}" is registered`);
  const toolById = new Map(tools.map((t) => [t.id, t]));
  const taken = new Set<string>();

  return {
    tools,
    actions,
    layers: Object.fromEntries(
      CANVAS_LAYERS.map((layer) => [layer, content.filter((c) => c.layer === layer)]),
    ) as Record<CanvasLayer, LayerContent[]>,
    panels,
    handles: new Map(handles.map((h) => [h.name, h])),
    tool: (id) => toolById.get(id) ?? fallback,
    shortcuts: { tools: shortcutMap(tools, taken), actions: shortcutMap(actions, taken) },
  };
}
