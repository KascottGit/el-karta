# 0006 Floor editor canvas

Status: accepted (M3)

## Decision

The 2D editor (`apps/web/src/features/floorplan/`) is a Konva stage that features plug into, rather than one component that knows every tool.

- **Extensions.** Each feature folder (walls, areas, openings, grid, background, …) exports one `EditorExtension` with its tools, toolbar actions, drag handles, side-panel sections and layer content, and adds one line to `extensions.ts`. `canvas/` holds only infrastructure and the select tool. `features/floorplan/README.md` has the recipe.
- **Two stores.** UI state (tool, selection, viewport, render window, the shape being drawn) lives in the editor store, separate from the model store. It never enters undo/redo or saving. Model changes still go only through `applyEdit`.
- **Layers.** Six logical layers in a fixed order (background, grid, areas, walls, openings, overlays) are Konva groups on three Konva layers, i.e. three canvases:
  - background and grid, which rarely change;
  - model content;
  - overlays, which redraw on every hover.

  Konva advises against more than a few layers, and every canvas is redrawn and composited on each pan. With this grouping, a hover preview redraws only the overlay canvas.

- **Render window.** Panning sets the stage transform directly and never re-renders React. Layers cull against a render window: the view plus half a view on every side. The window only changes when the view leaves it, when the zoom changes by more than 1.5× or on zoom to fit. Layers read it through `useDeferredValue`, so mounting the shapes that come into view happens in an interruptible background render instead of one long frame.
- **Input.** A custom gesture controller (`canvas/gestures.ts`) turns pointer events into hover, tap, double tap, drag, pan and pinch. `canvas/pointer-dispatch.ts` sends each gesture on:
  - a drag that starts on a registered handle goes to that handle;
  - other gestures go to the active tool;
  - a drag the tool doesn't take pans the view.

  Hit-testing of selectable items and handles uses Konva's hit graph, with a finger-sized search radius for touch.

## Why a custom gesture controller

`@use-gesture/react` and Konva's own `draggable` were considered.

- **Arbitration.** The editor must decide per press whether a drag belongs to a handle, the tool or the view, and change its mind when a second finger lands. Pan has to win for the middle button and Space. A tap on a handle must still reach a drawing tool. That arbitration is the actual logic; a gesture library would only supply the raw drag and pinch events underneath it.
- **Konva `draggable`** starts drags from compatibility mouse events. To claim a press from the canvas's own pan handling, a shape would have to cancel the pointerdown, and the browser then suppresses exactly those mouse events, so mouse drags never start. It also moves nodes outside React and the model.
- **Testability.** The controller and the dispatch are about 300 lines with no DOM dependencies, so every case (thresholds, double tap, pinch handover, cancel on Escape or a second finger) is unit-tested without a browser. A library would need DOM-level tests.
- **Small and unchanging.** The scope is fixed (pointer events only, no inertia or rubber-banding), so there is little to maintain.

## Consequences

- Features never use Konva `draggable` or attach their own pointer listeners to the stage. They use `handle(spec, payload)` and the `Tool` callbacks.
- Pan and zoom performance is measured by `apps/web/e2e/canvas-perf.spec.ts` on the large synthetic project. It pans across several render windows and reports p95, max and dropped frames. It asserts the 16 ms budget only with `PERF_BUDGET=1`, because shared CI runners vary.
