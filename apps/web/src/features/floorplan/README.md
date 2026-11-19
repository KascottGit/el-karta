# Floor editor

`floor-editor.tsx` is the page body: a header (back link, floor name; further header items such as the floor switcher or save status go after the `<h1>`) and the `EditorWorkspace` (`canvas/editor-workspace.tsx`): toolbar, Konva canvas and side panel.

## State

- **Model** (`@/model/store`): the project. Change it only with `modelStore.getState().apply(edit)` using the edit operations in `@el-karta/core`; undo, redo and saving follow from that.
- **Editor** (`editor-store.ts`): active tool, selection, viewport, canvas size, render window and the shape being drawn (`drawing`). UI-only: never undone or saved.

## Adding a tool, panel, action or layer content

Each feature lives in its own folder (`walls/`, `areas/`, …) and exports one `EditorExtension` (`canvas/extension.ts`). Register it with one line in `extensions.ts`. Nothing in `canvas/` needs to change.

```ts
// walls/extension.ts
export const wallsExtension: EditorExtension = {
  id: 'walls',
  tools: [wallTool], // toolbar button + pointer handling
  layers: [{ id: 'wall-draft', layer: 'overlays', order: 0, Component: WallDraft }],
  panels: [
    { id: 'wall-props', order: 10, visible: (e) => hasWall(e.selection), Component: WallPanel },
  ],
};
// extensions.ts
export const extensions = [baseExtension, wallsExtension];
```

Ids must be unique across extensions, as must shortcuts; `resolveExtensions` throws on a clash.

### Tools

A `Tool` gets pointer callbacks with `world` (metres) and `screen` (pixels) positions: `onHover` (mouse and pen only), `onTap`, `onDoubleTap` (replaces the second tap; falls back to `onTap`), `onDragStart`/`onDrag`/`onDragEnd`/`onDragCancel`, and `onKeyDown`, which sees every key first. A drag the tool does not take (no `onDragStart`, or it returns false) pans the view, so one-finger drags pan on phones.

Keep the in-progress shape in `editorStore` (`setDrawing`) and draw it from a layer component on `overlays`. Switching tools clears it. Escape (when `onKeyDown` does not handle it) clears the drawing, then the selection, then returns to the select tool.

### Layer content

`CANVAS_LAYERS` sets the drawing order: `background`, `grid`, `areas`, `walls`, `openings`, `overlays`. A `LayerContent` component renders Konva nodes in world coordinates (metres, y down) and gets `ctx` (floor id, `itemAt`, `zoomToFit`). Optional `bounds(floor)` adds to zoom to fit.

- **Culling:** read `useEditorStore((s) => s.renderWindow)` and filter with `createCuller(boundsFn)` (`canvas/culling.ts`). The window is larger than the view and only changes when the view leaves it, so panning does not re-render React; the stage transform is set directly.
- **Constant-pixel sizes:** strokes with `strokeScaleEnabled={false}`; text laid out in pixels and scaled by `1 / renderWindow.scale` (see `render/areas-layer.tsx`).
- **Selection:** spread `selectable(collection, id)` (`canvas/hit.ts`) on a node, and the select tool will pick it via Konva's hit graph. Set `listening={false}` on decoration such as labels. Read `selection` from the editor store to highlight.
- **Handles:** a Konva node that handles its own press calls `e.evt.preventDefault()` in `onPointerDown`; the canvas then neither pans nor passes that gesture to the tool.

### Panels and actions

A `Panel` shows in the side panel (a sheet over the canvas on phones) while `visible(editor, model)` holds. An `Action` is a one-shot toolbar button with `run(ctx)` and an optional `enabled(editor, model)`. Panels and actions edit the model with `apply(edit)` like everything else.

## Input

| Input                                                                  | Effect                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Wheel, trackpad pinch                                                  | Zoom at the pointer                                               |
| Shift + wheel                                                          | Pan                                                               |
| Middle-button drag, Space + drag, drag where the tool does not take it | Pan                                                               |
| Two fingers                                                            | Pinch-zoom and pan                                                |
| Escape                                                                 | Cancel (see above)                                                |
| Delete, Backspace                                                      | Delete the selection                                              |
| Ctrl/Cmd + Z, Ctrl/Cmd + Shift + Z, Ctrl + Y                           | Undo, redo                                                        |
| Single key                                                             | The tool or action with that `shortcut` (V select, F zoom to fit) |
