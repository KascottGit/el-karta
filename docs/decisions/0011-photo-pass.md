# 0011 Photo pass: photos as attachments, image references, homography

Status: accepted (M11, 2026-11-24). Builds on ADR 0007 and ADR 0010.

## Decision

- **Photos are attachments, not floor data.** A photo is an `attachments` row with `kind: 'photo'`, `floor_id` and `region` = core `AttachmentRegion` (`{ roomId, wallId? }`): the room it was taken in and the wall it faces. The floor document does not change. Devices made from a photo list it in `attachmentIds`, as evidence. Photos are re-encoded in the browser (long side at most 2048 px, JPEG), which also drops EXIF and its GPS position.
- **The model reads the image; code computes metres (principle 7).** The photo pass gets the room's walls (named A, B, … clockwise), the openings on them (`O1`, …) and the devices already there (`E1`, …), and returns image points only, normalised to 0–1000:
  - **references**: corners of walls (where they meet floor and ceiling) and of opening frames, as seen in the photo;
  - **features**: device type (`<domain>.<type>`), wall letter or `ceiling`, box, visible props, count, confidence, and the existing device it is, if any.
- **Placement through a homography.** References with known wall-plane coordinates (metres along the wall from `a`, metres above the floor) fix a homography from the image to the wall plane, fitted by least squares (direct linear transform) over every usable point, 4 at least. A feature's box centre maps to `offset` and `height`. With fewer references, `offset` is interpolated along the wall and `height` is the type's default, and the suggestion is flagged `photo.position-rough`. Ceiling lights are not located from a photo of a wall: they go to the room centroid, flagged the same way. Openings and ceiling height are only corrected when the fit has at least 5 points.
- **`ml-matrix` for the fit.** The least-squares solution needs an SVD; `ml-matrix` is pure ESM JavaScript that runs in the browser, Node and Deno (`npm:` in `supabase/functions/deno.json`). A hand-written solve would only cover exactly four points.
- **Detectable types come from the plugins.** `DomainPlugin.aiHints.photo` describes what each type looks like; core `photoDetectables(registry)` turns that into plain data (with the type's placement, default height and ports) that the app sends as part of the pass input. `ai-passes` may not import plugins, and a new domain (the network plugin's data outlets) is detected without changing the pass.

## Why

A vision model is good at naming what it sees and pointing at it, and poor at metric estimates; a homography from known points on the wall is exact for a flat wall and fails visibly (few references, a large residual) instead of quietly. Keeping photos out of the floor document avoids a schema change and keeps big binary references out of the patch stream; the `attachments` table already had `kind` and `region` for this since M2.
