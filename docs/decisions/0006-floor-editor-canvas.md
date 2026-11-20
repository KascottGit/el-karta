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

- **Render window.** Panning sets the stage transform directly and never re-renders React. It redraws only the scene canvases; the hit graph is redrawn when something is next hit-tested. Layers cull against a render window: the view plus half a view on every side. The window only changes when the view leaves it, when the zoom changes by more than 1.5× or on zoom to fit. Layers read it through `useDeferredValue`, so mounting the shapes that come into view happens in an interruptible background render instead of one long frame.
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
- Editor performance is measured by `apps/web/e2e/canvas-perf.spec.ts` on the large synthetic project; see Performance below.
- A floor's background attachment is always a raster image. For an uploaded PDF, `background.pdfPage` only records which page the stored PNG was rendered from; the source PDF is not kept in M3 (M4 may decide to store it for text extraction). The image lies in the plan at `offset + R(rotation) · (u, v) · scale.metresPerPixel`, with rotation in degrees, clockwise on screen (`packages/core/src/geometry/background.ts`).
- Room and zone polygons follow wall centrelines, not the walls' inner faces. "Fill room" (`fillRoom` in `packages/core/src/geometry/room-fill.ts`) traces the face of the wall-centreline graph around the tapped point, and the room tool snaps to the same centrelines. A room's area therefore includes half the thickness of its walls, and rooms on either side of a wall share that side. Devices on a wall sit on its face (`wallFacePoint`), so with centreline rooms they lie inside the room they face rather than on its edge. Anything that derives rooms or their areas (M4's room detection, the 3D view, area figures) uses this convention; a net floor area is the polygon inset by half the wall thicknesses.
- A door's `hinge` and `swing` are relative to its wall's a→b direction, in plan coordinates with y down. `hinge: 'left'` puts the hinge at the opening's end towards wall end `a` (offset), `'right'` at the end towards `b` (offset + width). `swing: 'in'` opens to the left of a→b (the wall's `side: 'left'`), `'out'` to the right. Unset means `left` and `in`. A door placed in the editor opens towards the side the user tapped and is hinged on the user's left as seen from that side (`doorFacing` in `packages/core/src/geometry/opening.ts`), which gives the same physical door whichever way the wall was drawn. The 2D symbol, M4's opening detection and the 3D view all use this convention.

## Performance

`apps/web/e2e/canvas-perf.spec.ts` measures the busiest floor of the large synthetic project (110 walls, 64 openings, 48 rooms) in the dev build, which includes React's development overhead:

- **Pan:** a mouse drag across six render windows, zoomed in.
- **Zoom:** 40 wheel notches from there out to the whole floor and back.
- **Commit:** pressing Enter to finish a 20-wall polyline.
- **Tool previews:** hovering with every drawing tool, and dragging a wall corner, a room corner and an opening.
- **Phone:** a 390×844 touch viewport with the CPU slowed down four times (`Emulation.setCPUThrottlingRate`), pinch-zooming in and out and panning with one finger.

"Work" is the main-thread time of a frame's input events and animation frame callbacks, where Konva draws. React's deferred renders run outside it and show up as frame intervals over 17 ms instead. With `PERF_BUDGET=1` the spec asserts a work p95 under 16 ms for pan, zoom and every tool preview, a pan interval p95 under 17 ms and a commit interval under 50 ms. Without it, CI only checks loose bounds. The phone test only checks that it stays usable: a work p95 under 100 ms.

Numbers from M3, p50 / p95 / max in ms, with the frames over 17 ms. They are the spread of three runs on one laptop.

| Measurement            | Before T9                                | After T9                              |
| ---------------------- | ---------------------------------------- | ------------------------------------- |
| Pan, work              | 2.7–2.8 / 4.3–4.5 / 15–17, 0 over        | 1.5 / 2.4–2.5 / 3.8–5.2, 0 over       |
| Zoom, work             | 6.2–7.6 / 19–21 / 20–21, 8–10 of 40 over | 3.3–3.7 / 4.9–7.1 / 5.2–7.2, 0 over   |
| Commit, frame interval | longest 117                              | longest 17–33                         |
| Phone pan, work        | 5.0–5.9 / 9–12 / 20–23, 2–3 over         | 2.9–3.1 / 4.2–4.7 / 11–12, 0 over     |
| Phone pan, interval    | longest 200–217                          | longest 17, 0 over                    |
| Phone zoom, work       | 11.0–11.4 / 33–34 / 45–46, 16–20 over    | 7.6–7.9 / 12.5–13.2 / 17–18, 0–2 over |
| Phone zoom, interval   | 10–12 over                               | 0 over                                |
| Room corner drag       | 8.3–8.7 / 10–10.4 / 10–11.5              | 5.2–5.8 / 5.9–8.4 / 6.3–9.1           |

What made the difference:

- **No React work in the urgent render after a render window change.** A layer that reads the deferred window renders twice: first urgently with the old window, then in the background with the new one. Each layer builds its element list in one `useMemo` over its culled items, so the urgent render reuses the old elements. The culler returns the previous array while the same items are visible, so a window change that brings nothing new into view (zooming out over a floor that is already fully shown) changes nothing at all.
- **Constant-size decoration reads the zoom when Konva draws it.** Room and zone labels (`ScreenLabel`) and issue markers (`IssueMarker`) are Konva `Shape`s whose `sceneFunc` divides by `shape.getAbsoluteScale()`. They no longer take the render window's scale as a prop, so zooming never re-renders them, and labels are now exactly 12 px at every zoom instead of up to 1.5× off.
- **Panning and zooming draw only the scene.** The view change sets the stage transform with Konva's automatic redraw turned off and redraws each layer's scene on the next frame. The hit graph is marked out of date and redrawn by the next hit test (`invalidateHitGraph` in `canvas/hit.ts`), so no pan or zoom frame pays for it. Before, every view change drew both, and the hit graph was about 45% of Konva's drawing time.
- **An edit re-renders only what shows the change.** The editor pages subscribed to the whole model, so every edit re-rendered the page, the toolbar and the Konva `Stage`. Re-rendering the stage makes react-konva reconcile every layer, which rebuilt every wall, opening and room element. That was nearly all of the 117 ms commit frame: validation (`floorIssues`), `LiveGraph.update` and the culler took about 1–3 ms each. `FloorEditor` and `FloorCanvas` are now memoized and `FloorEditor` reads only the floor's name. The rest of the commit frame is the layers rebuilding their element lists for the changed walls.
- **A drag preview re-renders only the dragged item.** A room or zone corner drag re-rendered the whole areas layer on every pointer move; each area now subscribes to the drag of its own id. Konva still redraws the model layer per move, because the dragged room is drawn in place. Wall corner and opening drags are drawn on the overlay layer and do not touch the model layer. The other tools' hover previews already redrew only the overlay layer.

The render window's 1.5× zoom hysteresis was kept: with the urgent render free and unchanged culls short-circuited, a window change during zoom costs nothing measurable in the work probe.
