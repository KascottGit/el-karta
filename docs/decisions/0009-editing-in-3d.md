# 0009 Editing in 3D with custom gizmos

Status: accepted (M9b). Amends ADR 0008, which kept the 3D view read-only.

## Decision

Walls and openings (doors, windows, passages) can be moved and resized in the 3D view as well as in 2D. New items are still drawn and placed in 2D.

- **One set of pure edit functions for both views.** Each gizmo maps a drag to the same pure function the 2D handles use (`walls/corner.ts` `moveEnds`, `walls/move-wall.ts` `moveWall`, `openings/resize.ts`), and commits the result with one edit through `applyEdit` on release. There is no 3D-only way to change data.
- **Openings are drawn and pickable.** Each opening fills its cut-out with one piece (door leaf, glass pane, or an undrawn pick volume for a passage), merged per floor with a triangle → opening id table like the walls. The cut-out in the wall itself is unchanged.
- **Custom handle meshes, not drei `TransformControls` or `PivotControls`.** Those move an object's matrix along fixed axes and scale symmetrically about a pivot. Our handles move one edge of an opening while the other stays, are constrained to a wall's own frame, and clamp to domain limits (inside the wall, not overlapping a neighbour, minimum sizes), so their output is a data field, not a matrix. One shared helper handles pointer capture, stopping the orbit controls, cancelling (Escape, a second finger) and the ray maths (closest point between the pointer ray and an axis line, or the ray's hit on a plane); each gizmo only supplies its constraint and its pure function. Handles keep a constant screen size and are larger for touch.
- **Live preview without edits.** During a drag the dragged floor is drawn from a preview `FloorData` held by the 3D view (the committed data with the gizmo's result put in). The per-`FloorData` build cache treats it like any other data object, so only that floor rebuilds, and undo, saving and sync see one edit at the end.

## Why

Adjusting the height of a window or the width of a door is easier where you can see it, and the M11 photo flow will have people in 3D comparing the model with a photo. Sharing the pure functions with 2D keeps one way of editing and makes both views behave the same. A gizmo library would need wrapping to undo its matrix model for each of our constraints, which is more code than the handles themselves.
