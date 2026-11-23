# 3D view

The read-only 3D view of the floor editor (ADR 0008).

## Geometry (`geometry/`)

Pure functions that turn floor data into boxes, outlines and device transforms. They import no three.js and are unit-tested like core geometry.

**Coordinates.** Everything is in plan coordinates: metres, x right, y down, z up. Each floor is built in floor-local coordinates, with z = 0 at the floor's surface (its `elevation`); `floorBases` gives the z each visible floor is drawn at (its elevation, plus the gaps of the exploded view), and the renderer raises the floor's meshes by it. Changing the visible floors or toggling the exploded view therefore never rebuilds a floor's geometry. The renderer maps a plan point `(x, y, z)` to three.js `(x, z, y)`; that swap mirrors the scene, so it also flips the winding of triangles it builds and the sense of rotations about z.

**Boxes** (`Box`): `center`, `size` and `rotation`. `size.x` runs along the box's own x axis (a wall's length), `size.y` across it (a wall's thickness) and `size.z` is the height. `rotation` is in radians and turns the box's x axis from plan +x towards plan +y, i.e. clockwise on screen in the 2D plan.

**Walls** (`wallPieces`): each wall is split along its length around its openings, so the pieces are a full-height piece between openings, a sill piece under each window and a lintel above each opening, up to `wall.height ?? floor.height`. An opening's `offset` is its start, measured from wall end `a`, and it spans `offset … offset + width` (ADR 0006); openings are clamped to the wall, and overlapping openings cut their union. A wall end that meets another wall's end (within `JOINT_TOLERANCE`, the same test as the 2D wall outline) is extended by half the wall's thickness, which closes L corners and T corners built from three wall ends. A wall end on the middle of another wall needs no extension: it ends on that wall's centreline, inside its body. Every piece carries its `wallId`.

**Rooms** (`roomSlabs`): the room polygon at z = 0, for the renderer to triangulate. Rooms with an invalid polygon are left out. Ceilings are not drawn.

**Devices** (`deviceTransforms`): a device with a floor placement and a positive `size` is a box standing on the floor at `at`, turned by `placement.rotation` (degrees, clockwise on screen, the same sense as the background's rotation). Every other device is a marker at its `resolvePlacement` position with the shape and colour from `features/devices/appearance.ts` and a `facing` unit vector (out of the wall face, down from a ceiling, up from the floor). A device that cannot be placed is a `flagged` marker at its approximate position, or is skipped when there is none. Devices in a container have no transform.

**Bounds**: `buildFloorGeometry` returns a floor's local `bounds`; `stackedBounds` combines the visible floors at their bases for zoom to fit.
