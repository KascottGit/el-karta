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
- A floor's background attachment is always a raster image. For an uploaded PDF, `background.pdfPage` only records which page the stored PNG was rendered from; the source PDF is not kept in M3 (M4 may decide to store it for text extraction). The image lies in the plan at `offset + R(rotation) · (u, v) · scale.metresPerPixel`, with rotation in degrees, clockwise on screen (`packages/core/src/geometry/background.ts`).
- Room and zone polygons follow wall centrelines, not the walls' inner faces. "Fill room" (`fillRoom` in `packages/core/src/geometry/room-fill.ts`) traces the face of the wall-centreline graph around the tapped point, and the room tool snaps to the same centrelines. A room's area therefore includes half the thickness of its walls, and rooms on either side of a wall share that side. Devices on a wall sit on its face (`wallFacePoint`), so with centreline rooms they lie inside the room they face rather than on its edge. Anything that derives rooms or their areas (M4's room detection, the 3D view, area figures) uses this convention; a net floor area is the polygon inset by half the wall thicknesses.
- A door's `hinge` and `swing` are relative to its wall's a→b direction, in plan coordinates with y down. `hinge: 'left'` puts the hinge at the opening's end towards wall end `a` (offset), `'right'` at the end towards `b` (offset + width). `swing: 'in'` opens to the left of a→b (the wall's `side: 'left'`), `'out'` to the right. Unset means `left` and `in`. A door placed in the editor opens towards the side the user tapped and is hinged on the user's left as seen from that side (`doorFacing` in `packages/core/src/geometry/opening.ts`), which gives the same physical door whichever way the wall was drawn. The 2D symbol, M4's opening detection and the 3D view all use this convention.
