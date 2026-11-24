# Furnishing

The editor side of `@el-karta/plugin-furnishing` (desks, beds, shelves and the like as plain boxes). The generic devices layer (`features/devices/`) draws furniture as its footprint in 2D and the 3D view as a box; this folder only adds editing.

- `furniture-tool.ts`: the furniture tool places an item of the type chosen in its side panel, at the plugin's default size, centred where it is tapped and in the room under that point (core `roomAt`, the smallest room containing it). The new item is selected.
- `furniture-handles.ts`, `furniture-overlay.tsx`: selected furniture gets a move handle (its body) and a rotation knob behind it (its local -y side). The drag previews through `deviceDragStore`; dropping makes one `updateDevice` edit. Rotation snaps to `ROTATION_STEP` degrees unless Alt is held or snapping is off. A moved item takes the room it then stands in; moved out of every room it keeps its old one, since `updateDevice` cannot clear an optional field.
- `furniture-panels.tsx`: type, name, width, depth, height and rotation of the selected furniture. Changing the type takes the new type's default size unless the item was resized.

Sizes and rotation follow ADR 0008: `size.x` width, `size.y` depth, `size.z` height in metres, centred on `at`; `rotation` in degrees from plan +x towards +y, stored in [0, 360). Type names are the shared `devices.types.furnishing.<type>` keys.
