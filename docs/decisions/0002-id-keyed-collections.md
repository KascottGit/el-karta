# 0002 Id-keyed collections in documents

Status: accepted (M1), replaces the array shape sketched in PLAN.md

## Context

PLAN.md sketches `walls`, `openings`, `rooms`, `zones`, `devices` and `connections` as arrays. Saving and offline sync replay Immer patches on top of a newer version of a floor document. Immer patch paths address array items by index (`devices/3/label`), so after someone else inserts or removes an item, a replayed patch silently changes the wrong item.

## Decision

Every collection in `FloorData` and `ProjectData` (including `buildings` and `crossFloorConnections`) is a record keyed by item id: `devices: Record<Id, Device>`. The item still carries its own `id`, and a validator checks that key and id match. Edit operations replace small array fields (polygons, ports) whole.

Patch paths then look like `data/devices/<id>/label`. Replaying them on a changed document either hits the same item or, if it was deleted, fails a pre-check and is reported to the user (`replayChanges`), as PLAN.md requires.

## Consequences

- Normalised state is the standard pattern for editors with patches (Redux, Immer docs); no custom patch format is needed.
- Item order is not stored. Anything that needs an order (floors, slots) has an explicit field (`sortOrder`, `slot`).
- JSON in the database is an object of objects instead of an array; JSON Schema for AI output can still use arrays and be converted when suggestions are accepted.
