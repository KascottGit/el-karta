# Photo evals

Ground truth for the photo pass (M11, ADR 0011): photos of our own home, the floor they were taken on, and what each photo shows. The Zod schemas in `facit.ts` define every file; `pnpm test` checks that every manifest photo has a facit that parses and fits its floor (room, walls and types exist, each type on a wall or the ceiling as its plugin says).

## Files

- Photos go in the git-ignored `photos/` folder at the repo root (the repo is public). Name them `<home>-<room>-<n>.jpg`, e.g. `villa-kok-1.jpg`, lower case, no spaces or å/ä/ö. A photo's **name** is its file name without `.jpg`; it names the facit file and the CSV row.
- `floors/<home>.json`: the floor the photos were taken on, a `FloorRecord` (the stored floor document with its id, name and `data`) exactly as the dev-only **"Exportera våning"** button downloads it. In a dev build (`pnpm dev`), open the floor and press "Exportera våning" in the toolbar: it downloads `<floor-name>.json`; rename it to `<home>.json`. It gives the eval the real walls, openings and rooms. The runner reads it with `parseFloorRecord`, so a file exported before a schema change is migrated like a stored floor. Re-export it after changing the floor in the editor; the facit refer to its room and wall ids.
- `manifest.json`: `{ "imagesDir": "../../photos", "photos": [{ "file": "villa-kok-1.jpg", "sha256": "…", "home": "villa" }] }`, one entry per photo. `imagesDir` is relative to the manifest; `sha256` is the photo file's checksum (`sha256sum photos/villa-kok-1.jpg`).
- `facit/<name>.json`: the ground truth for one photo:

```json
{
  "room": "<room id in the floor JSON>",
  "wall": "<wall id the photo faces, or null for the room or its ceiling>",
  "devices": [
    {
      "type": "power.outlet",
      "wall": "<wall id, or \"ceiling\">",
      "count": 2,
      "props": { "earthed": true },
      "offset": 1.35,
      "height": 1.1
    }
  ],
  "notes": "Two double outlets above the counter; the switch by the door is cut off at the left edge."
}
```

`devices` lists every device of a detectable type (outlet, switch, wall light, ceiling light) that is visible in the photo, also ones already in the model. `type` is `<domain>.<type>`. `count` (units in one frame, `Device.count`: 2 for a double outlet), `props`, `offset` and `height` are optional: leave out what was not checked. `offset` is the model's `WallPlacement.offset`: metres along the wall from its `a` end (on the wall's centre line, so a corner is half the other wall's thickness in) to the device's centre; the easiest way to get it is to place the device at the measured spot in the editor and read the offset off the power panel. `height` is metres from the floor to the device's centre. A ceiling device has neither. Measured offsets and heights make the placement scores possible.

`detectable.ts` builds what the app sends as `PhotoInput.detectable` with the same `photoDetectables` over the same plugins. A web test (`apps/web/src/features/floorplan/dev/floor-export.test.ts`) fails if its plugin list and the app's (`apps/web/src/plugins.ts`) differ; add a new plugin to both.

## Running

```sh
pnpm eval photo [--provider anthropic|gemini] [--model <id>] [--photos villa-kok-1,villa-kok-2] [--earlier] [--images ../photos]
```

`--provider` and `--model` default as for the floor-plan evals (`defaultModels['photo']`: `claude-haiku-5-5`, or `gemini-3-flash-preview` with `--provider gemini`), with no fallback. The keys come from the shell or `supabase/functions/.env` in the same way. `--images` overrides the manifest's `imagesDir` (useful in a git worktree).

Before any call the runner parses every facit and floor it needs, refuses facit that do not fit their floor, and checks every photo it will send against its `sha256`. Then, per photo, it does what the app's analysis does (`apps/web/src/features/photos/analysis.ts`), in Node:

1. Builds the context with `photoContext` from `@el-karta/ai-passes` (the same code the app uses) from the exported floor and the facit's `room` and `wall` as the photo's region. The floor's devices are left out, so every visible device has to be found in the photo, as on a first photo of the room; otherwise the pass would drop the ones the model recognises as existing.
2. Decodes the photo turned upright by its EXIF orientation, scales it to at most 2048 px on the long side and encodes it as JPEG at the app's quality (`PHOTO_MAX_SIDE`, `PHOTO_QUALITY` from `@el-karta/ai-passes`), as the app stores it on upload.
3. Earlier photos: none by default, so each photo is judged alone (mode `alone`). With `--earlier` (mode `earlier`) it sends up to three other manifest photos of the same home and room, taken before it (earlier in the manifest), picked with the app's `earlierPhotos` (same wall first, then the most recent), as the app does when it analyses a photo on upload, at 1024 px (`EARLIER_PHOTO_SIDE`). The app shrinks them further only to stay under the Edge Function's 4 MB body cap, which the eval does not have.
4. `runPass(photoPass, …)` (the retry on validation errors included), then `photoPass.toSuggestions` with nothing pending.
5. Scores the device suggestions against the facit.

Each photo appends one row to `evals/results/photo.csv` (committed) and writes the context, the run (output, issues, usage) and the suggestions to `evals/results/raw/` (git-ignored); the images are not written. Columns change by the same rule as `floorplan.csv` (`appendCsv`).

## Scores (`score.ts`)

Devices are paired greedily (`matchDevices`), each at most once, in three rounds: same type on the same wall, then same type on another wall, then another type on the same wall. The ceiling counts as one more wall. Within a round, pairs on the same wall whose offsets are both known go first, nearest first; the rest follow in facit order, then found order. A pair from the first round is **exact**.

| Column                     | Meaning                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `expected`, `found`        | Devices in the facit, and device suggestions made.                                                                                                                                                     |
| `matched`                  | Pairs from all three rounds.                                                                                                                                                                           |
| `precision`, `recall`      | Exact pairs over `found`, and over `expected`.                                                                                                                                                         |
| `typeAccuracy`             | Share of pairs whose type is right (only third-round pairs have the wrong type).                                                                                                                       |
| `wallAccuracy`             | Share of pairs on the right wall, or both on the ceiling (only second-round pairs are on the wrong wall).                                                                                              |
| `countAccuracy`            | How well the number of devices per type matches, ignoring walls: 1 − Σ\|found − expected\| / Σ max(found, expected) over the types; per type min / max. 1 when nothing was expected and nothing found. |
| `countsByType`             | Per type `found/expected`, e.g. `power.outlet=2/3 power.switch=1/1`; the summary pools it into a count accuracy per type.                                                                              |
| `unitCountAccuracy`        | Exact pairs where the facit has a `count`: share whose suggested `count` is the same.                                                                                                                  |
| `propsAccuracy`            | Exact pairs: share of the facit's props that the type's plugin lets the model see (`visibleProps`) whose suggested value is the same.                                                                  |
| `meanOffsetError`          | Exact wall pairs where the facit has an `offset`: mean absolute difference in metres.                                                                                                                  |
| `meanHeightError`          | The same for `height`.                                                                                                                                                                                 |
| `roughShare`               | Share of the suggestions flagged `photo.position-rough` (fewer than four usable references, a poor fit, or a ceiling light).                                                                           |
| `corrections`              | Opening and ceiling-height corrections suggested; the facit says nothing about them, so they are only counted.                                                                                         |
| `mode`, `earlier`          | `alone` or `earlier` (`--earlier`), and how many earlier photos were sent.                                                                                                                             |
| `status`, `calls`, …       | The run's status, calls (incl. the validation retry), tokens, duration and error.                                                                                                                      |
| `provider`, `costUsd`, ... | As in `floorplan.csv`: the cost from `modelPrices` (see the floor-plan README, "Cost"); empty for a model without a price.                                                                             |

A failed run (no output) has only `expected`; it counts in the summary's failure rate, cost and duration.

## Summary

`pnpm eval summary` writes `evals/results/photo-summary.md` (committed) from `photo.csv`, next to the unchanged `floorplan-summary.md`: one column per provider, model and mode, with the runs and distinct photos, the mean of each score column over the rows that have it, `countAccuracy` per type pooled over the rows from `countsByType`, the mean cost per photo, the median and p90 duration and the failure rate. Run it after every eval run and commit both files.

## What to photograph

30 or more photos: every kitchen wall; walls in other rooms with outlets, switches and lights; some with a door or window in view and some without (the placement then has fewer reference points); a few ceilings. Stand back far enough to see where the wall meets the floor and, ideally, the ceiling. Take a photo of the same wall twice from different angles now and then; the second must not add duplicates.
