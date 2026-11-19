# Floor editor

`floor-editor.tsx` is the page body. It has a header (back link, floor name, floor switcher, save status) and the `EditorWorkspace` (`canvas/editor-workspace.tsx`), which holds the toolbar, the Konva canvas and the side panel. ADR 0006 explains the design.

## State

- **Model** (`@/model/store`): the project. Change it only with `modelStore.getState().apply(edit)` using the edit operations in `@el-karta/core`; undo, redo and saving follow from that.
- **Editor** (`editor-store.ts`): active tool, selection, viewport, canvas size, render window and the polyline being drawn (`drawing`). It is UI-only and is never undone or saved.

## Adding a feature

Each feature lives in its own folder (`walls/`, `areas/`, `openings/`, …) and exports one `EditorExtension` (`canvas/extension.ts`). Register it with one line in `extensions.ts`. `canvas/` holds only infrastructure and the select tool, so a feature never needs to change it. `walls/` and `areas/` are working examples.

```ts
// walls/extension.ts
export const wallsExtension: EditorExtension = {
  id: 'walls',
  tools: [wallTool], // toolbar button + pointer callbacks
  handles: [wallEnd], // draggable points
  layers: [
    { id: 'walls', layer: 'walls', order: 0, Component: WallsLayer, bounds: wallsBounds },
    { id: 'wall-draft', layer: 'overlays', order: 0, Component: WallDraft },
  ],
  panels: [{ id: 'wall-props', order: 10, visible: hasWallSelected, Component: WallPanel }],
};
// extensions.ts
export const extensions = [baseExtension, areasExtension, wallsExtension];
```

Ids must be unique across extensions (tools, actions, handles, panels, layer content), and so must shortcuts. `resolveExtensions` throws on a clash.

### Tools

A `Tool` gets pointer callbacks with a `CanvasPointer`: `world` (metres), `screen` (pixels), `kind` (mouse, pen or touch), modifier keys and `onHandle`.

- `onHover` (mouse and pen only) and `onLeave` (the pointer left the canvas).
- `onTap`, and `onDoubleTap`, which replaces the second tap and falls back to `onTap`.
- `onDragStart`, `onDrag`, `onDragEnd`, `onDragCancel`. A drag the tool does not take (no `onDragStart`, or it returns false) pans the view, so one-finger drags pan on phones.
- `onKeyDown` sees every key first; returning true stops the default handling.
- `onDeactivate` is called before switching to another tool, on Escape and on floor switch. Reset your preview state there.

Preview state:

- A polyline or polygon in progress goes in `editorStore` (`setDrawing({ points, hover })`) and is drawn from a layer on `overlays`. Tool switch, floor switch and Escape clear it.
- Any other preview (a snap marker, the wall and offset an opening would land on) goes in a small store in your feature folder, reset in `onDeactivate` and `onLeave`.

Escape first cancels a drag in progress. If `onKeyDown` does not handle it, it then clears the drawing, then the selection, then returns to the select tool.

**Tolerances:** give snap and hit distances in pixels and convert them with `ctx.pxToWorld(px)`, so they feel the same at every zoom. Use a larger value for `p.kind === 'touch'`.

### Handles (draggable points)

Do not use Konva `draggable` or attach pointer listeners to shapes. Register a `Handle` and spread `handle(spec, payload)` (`canvas/hit.ts`) on the Konva node:

```tsx
const wallEnd: Handle<{ wallId: Id; end: 'a' | 'b' }> = {
  name: 'wall-end',
  onDrag: ({ wallId, end }, p, ctx) => {
    /* preview at p.world */
  },
  onDragEnd: ({ wallId, end }, p, ctx) => {
    /* modelStore.getState().apply(...) */
  },
  onDragCancel: ({ wallId }) => {
    /* drop the preview */
  },
};
// In the layer component; see "Sizes in pixels" below for `scale`.
const scale = useEditorStore((s) => s.viewport.scale);
<Circle {...handle(wallEnd, { wallId, end: 'a' })} x={a.x} y={a.y} radius={6 / scale} />;
```

A node can be both selectable and a handle, e.g. an opening you select by tapping and slide by dragging. Plain spreading would keep only the last `name`, so merge the two with `nodeProps`:

```tsx
<Line {...nodeProps(selectable('openings', o.id), handle(openingSlide, { id: o.id }))} … />
```

The select tool selects such a node on tap. A tap on a bare handle, such as a wall end, keeps the current selection.

A drag that starts on a handle goes to that handle, whichever tool is active. It gets the same threshold, pointer capture and cancellation (Escape, a second finger, unmount) as any drag. A tap on a handle still reaches the tool with `p.onHandle` set; the select tool ignores it. Touch presses find handles within a fingertip's radius. `dev/` has a test handle (open `/dev/synthetic/small?test-handle`) that the e2e tests drag.

### Layer content

`CANVAS_LAYERS` sets the drawing order: `background`, `grid`, `areas`, `walls`, `openings`, `overlays`. A `LayerContent` component renders Konva nodes in world coordinates (metres, y down) and gets `ctx` (floor id, `itemAt`, `pxToWorld`, `zoomToFit`). The optional `bounds(floor)` adds to zoom to fit.

- **Culling:** read `useRenderWindow()` and filter with `createCuller(boundsFn)` (`canvas/culling.ts`). The window is larger than the view and changes rarely, and it is deferred, so panning neither re-renders React nor stalls when new shapes come into view. Memoize per-item shape components (`memo`) so a window change only mounts the new ones.
- **Sizes in pixels:** strokes use `strokeScaleEnabled={false}`. For anything else, divide a pixel size by a scale (pixels per metre) from the editor store:
  - `useEditorStore((s) => s.viewport.scale)` is exact, but re-renders the component on every zoom step. Use it for the few nodes whose size matters, such as handles.
  - `useRenderWindow().scale` changes only with the render window, so it is cheap for many nodes, but can be off from the current zoom by up to 1.5×. Labels (`ScreenLabel`, `canvas/screen-label.tsx`) use it. Handles sized with it can differ by up to 1.5× in size and hit area.
- **Selection:** spread `selectable(collection, id)` on a node, and the select tool picks it through Konva's hit graph. Set `listening={false}` on decoration such as labels. A shape that lies over others (zones over rooms) should hit only on its outline with a `hitFunc`, as `areas/areas-layer.tsx` does. Read `selection` from the editor store to highlight.
- **Colours:** shared ones (selection, labels, font) are in `canvas/theme.ts`; feature colours live in the feature folder.

### Panels and actions

A `Panel` shows in the side panel while `visible(editor, model)` holds. On phones the side panel is a sheet over the canvas. An `Action` is a one-shot toolbar button with `run(ctx)` and an optional `enabled(editor, model)`. Both edit the model with `apply(edit)` like everything else.

## Input

| Input                                                            | Effect                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| Mouse wheel on Windows and Linux (notches)                       | Zoom at the pointer                                               |
| Trackpad pinch, Ctrl/Cmd + wheel                                 | Zoom at the pointer                                               |
| Trackpad two-finger scroll, mouse wheel on macOS, Shift + wheel  | Pan                                                               |
| Middle-button drag, Space + drag, a drag no handle or tool takes | Pan                                                               |
| Two fingers                                                      | Pinch-zoom and pan                                                |
| Escape                                                           | Cancel a drag, else see Tools above                               |
| Delete, Backspace                                                | Delete the selection                                              |
| Ctrl/Cmd + Z, Ctrl/Cmd + Shift + Z, Ctrl + Y                     | Undo, redo                                                        |
| Single key                                                       | The tool or action with that `shortcut` (V select, F zoom to fit) |

Browsers do not say whether a wheel event comes from a mouse or a trackpad, so the wheel rows follow a fixed rule (`canvas/wheel.ts`):

- Line or page deltas zoom.
- A vertical pixel delta that is a whole number of at least 50 device pixels (`deltaY × devicePixelRatio`) zooms. This makes a notch zoom at any browser zoom or display scaling.
- Everything else pans.

A mouse on macOS sends notches of about 4 px, which look like trackpad scrolling, so it pans there. Pinch or Cmd + wheel zooms on every platform.
