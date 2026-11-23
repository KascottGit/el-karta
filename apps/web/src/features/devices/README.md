# Devices

Generic drawing of devices, shared by the 2D editor and the 3D view (ADR 0008). Domains (furniture, power) add their own tools and panels on top of this instead of a second device layer.

- `appearance.ts`: marker shape and colour per `domain:type`, with a domain and a generic fallback. `hasOwnMarker` leaves out devices in a container (breakers in a panel).
- `placement.ts`: where a device is drawn. `drawnPosition` is the resolved position, or the approximate one while the device is flagged, or none, and then the device is not drawn. `sizedFootprint` is a floor placement with a positive `size` (furniture), drawn as its footprint in 2D and a box in 3D; `size` and `rotation` follow ADR 0008.
- `device-marks.ts`: the drawn devices of a floor, cached so that unrelated edits keep the same objects.
- `device-issues.ts`: the validator's issues per device. Flagged devices take the colour of their worst issue.
- `extension.ts`: the `devices` editor extension. Its layer content sits on the `openings` logical layer above the openings, so it is in the model's Konva layer and not redrawn on every pointer move. One shape paints all markers from cached sprites; each marker has a hit-only shape (`hitFunc`, no `sceneFunc`) so it can be tapped.
- `type-name.ts`: a type's Swedish name is the i18n key `devices.types.<domain>.<type>`, falling back to `devices.types.generic`. A domain adds its names there.
