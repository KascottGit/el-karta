# Floor-plan evals

`manifest.json` lists the plans (images are git-ignored in `floorplans/`, checked by `sha256`). `facit/<id>.json` is the ground truth. The Zod schemas in `facit.ts` define both files; `pnpm test` checks that every manifest plan has a facit that parses.

## Running

```sh
GEMINI_API_KEY=… pnpm eval floorplan --model gemini-flash-latest [--estimate-scale] [--plans gotgatan-78,lundagatan-47] [--images ../floorplans]
```

The key comes from `GEMINI_API_KEY` in the shell. When that is not set, the runner reads `supabase/functions/.env` (the ignored file the local Edge Function uses), if it exists, and takes only `GEMINI_API_KEY` from it; its other settings, such as `AI_PROVIDER`, are ignored.

The runner (`run.ts`, `pipeline.ts`) does what the app's import does, in Node:

1. Renders the PDF page with pdf.js at the app's resolution (`pdfRenderScale` from `@el-karta/ai-passes`, which the app uses too: 4000 px on the long side) and takes the PDF page width in mm; an image file is used at its own size.
2. Calls `floorplan-locate` on the whole page, crops to `planCropBox`, cuts the crop into `planTiles` if it is still large, calls `floorplan` per tile and merges with `mergeFloorplanTiles`.
3. Runs `interpretFloorplan` with the background placed at the plan origin, unturned, so the result is in the image frame below.

Before any call it checks every selected plan against its `sha256` and refuses to run on a missing or changed file. `--images` overrides the manifest's `imagesDir` (useful in a git worktree).

`--estimate-scale` removes all printed scale evidence from the merged output (scale text, paper size, dimensions, scale bar, total and room areas) and does not pass the PDF page width, so the scale chain can only estimate from objects of standard size. Plans with a facit scale then score the estimate.

Each run appends one row per plan to `evals/results/floorplan.csv` (committed) and writes the model outputs, crop, tiles and interpretation to `evals/results/raw/` (git-ignored, for debugging). The API key is read by the provider and never printed or written.

## Scores (`score.ts`)

| Column                     | Meaning                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `roomsExpected/Found`      | Room count in the facit and in the result.                                                                   |
| `nameMatch`                | Share of facit rooms matched one to one by name (lower-case, whitespace ignored); unlabelled ones match any. |
| `typeAccuracy`             | Share of matched rooms whose type is one of the facit's `types`.                                             |
| `doorsExpected/Found`      | Door count.                                                                                                  |
| `scaleError`               | Found `metresPerImageWidth` over the facit's, minus 1; empty when either has none.                           |
| `estimateWithin10`         | Estimate mode, plans with a facit scale: the estimate is within 10 %. A run that failed counts as `false`.   |
| `rotationErrorDeg`         | Smallest angle between the found and the facit main wall direction, modulo 90°.                              |
| `roomAreaError`            | Mean absolute relative area error of matched rooms where both have an area, in square image widths.          |
| `wallLengthError`          | Full facit only: total wall length over the facit's, in image widths, minus 1.                               |
| `status`, `scaleStatus`, … | Worst call status, how the scale was found, tokens, calls (incl. retries), duration and the first error.     |

Geometry is compared in image widths (lengths divided by the metres per image width they were measured at, areas by its square), so `roomAreaError` and `wallLengthError` measure the walls and rooms only and a wrong scale shows up in `scaleError` alone. A light facit's printed areas are in m², so `roomAreaError` needs its `scale`; it is empty on plans without one.

## Facit format

- `level: "light"`: read off the plan by hand. Rooms with their name as printed (`null` if unlabelled), the room types that count as correct, the printed area if any; the number of doors (wardrobe and cupboard doors excluded; a double door counts once); `windows` is left out until someone counts them.
- `scale.metresPerImageWidth`: the real-world width the whole page covers, so it holds at any render resolution. `null` when the plan prints nothing to derive it from.
- `rotationDeg`: how far the plan's walls are turned from the page axes, in degrees in (-45, 45]: the angle of the main wall direction in image coordinates (x right, y down), so positive is clockwise on screen. A plan turned 25° anticlockwise is `-25`.
- `checked`: set to `true` once a person has checked the facit against the plan.

### Full facit

A full facit (`level: "full"`) is the AI result after a person has corrected it in the editor. In a dev build (`pnpm dev`), open the floor and press "Exportera facit" in the toolbar: it downloads `<floor-name>.json`. The floor needs a background and a scale. Rename the file and its `id` to the plan's id and put it in `facit/`.

It has every light field (`checked: true`, `rooms[].types` is the one type set in the editor, `totalArea` and `ceilingHeight` are `null`; fill them in by hand if wanted), plus:

- `image`: `{ width, height }` of the background image in pixels.
- `scale.metresPerImageWidth`: the floor's scale times the image width; `evidence` names the scale's source.
- `walls`: `{ a, b, thickness }`, and `rooms[].polygon`: points in **metres in the image frame**: origin at the image's top-left corner, x along its width, y down its height, unturned, whatever the floor's background placement. This is the frame the runner's results are in.
- `rooms[].area`: the polygon's area in m².
- `openings`: `{ kind, wall, offset, width }`, where `wall` indexes `walls` and `offset`/`width` are in metres as in the model.
- `doors`, `windows`: counted from the openings.
- `rotationDeg`: the walls' main direction, as above.
