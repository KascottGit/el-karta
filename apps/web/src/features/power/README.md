# Power

The editor side of `@el-karta/plugin-power` (outlets, switches, wall and ceiling lights; M5 adds panels, breakers and connections). The generic devices layer (`features/devices/`) draws them as markers in 2D and 3D (`appearance.ts`) and moves the selected ones along walls and around rooms; this folder adds placing and the side panel.

- `power-tool.ts`: the shared device tool with the power type chosen in the tool panel. Wall types attach to the nearest wall face within the snap reach, at the type's default height (`POWER_DEFAULT_HEIGHTS`); ceiling lights go in the room tapped. A tap that places nothing shows a notice in the tool panel.
- `power-panels.tsx`: the tool panel (type) and the panel of the selected power devices: type (only types placed the same way, so a device never changes wall for ceiling), name, outlet props (`count` as the number of sockets, `earthed`, `outdoor`), the switch `variant`, and for wall devices the height above the floor and the distance along the wall from its end `a`. Props are optional: "Okänt" removes one, so what nobody has seen stays unknown.
- `power-edits.ts`: `withPowerType` (drops props the new type lacks, adds the ports it needs and keeps the old ones, as connections may use them; a device still at the old type's default height takes the new one's), `withProp`, `withOffset` (clamped to the wall) and `withHeight`.

Type names are the shared `devices.types.power.<type>` keys; UI text is under `power.*`.

A device loses its `count` when it stops being an outlet, and the panel can set the count back to unknown.
