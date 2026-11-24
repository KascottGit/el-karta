# Photos

Photos of rooms and walls (M11 decisions 3 and 4). A photo is an `attachments` row with `kind: 'photo'` and `floor_id` set, whose `region` is core's `AttachmentRegion` (`{ roomId, wallId? }`); the floor document does not change. Analysing photos is added on top of this (M11 T4).

- `photo-tool.ts`: the "Foton" tool shows the panel. A tap in 2D selects the wall or room hit, or else the room under the pointer (a tap on a device or opening picks its room). The selection is the editor's shared one, so a wall or room tapped in the 3D view (through `view3d/select.ts`) is the target too; a device or opening tapped in 3D is not, and the panel keeps asking for a room or wall.
- `target.ts`: what the panel adds photos of. Exactly one selected room, or one selected wall; anything else asks the person to tap a room or wall. A wall's photo belongs to a room beside it (`roomsBesideWall`): with two or more the panel offers a choice, defaulting to the first; a wall in no room takes no photos. Devices found in a photo later take their side from that room.
- `compress.ts`: decoded with `createImageBitmap(file, { imageOrientation: 'from-image' })`, so EXIF orientation is applied, scaled to at most 2048 px on the long side and re-encoded as JPEG at quality 0.8 with the shared `encodeRegion`. Re-encoding drops all EXIF data, GPS position included.
- `photos-api.ts`: the floor's photos through React Query (`photosKey(floorId)`), upload and delete over the repository wrappers in `lib/attachments.ts`, and signed URLs through its shared `attachmentUrls` cache.
- `groups.ts`: the panel lists the target room's photos by the wall they face: the selected wall first (shown even before its first photo), then the other walls, then the room in general.
- `detach.ts`: deleting a photo (after a confirm) removes its id from `attachmentIds` of the floor's devices in one undoable edit, dropping the field when it becomes empty. The photo itself cannot be undeleted.

UI text is under `photos.*`.
