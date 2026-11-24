# Photo evals

Ground truth for the photo pass (M11, ADR 0011): photos of our own home, the floor they were taken on, and what each photo shows. The runner and scoring arrive in M11 T5; this file fixes the formats so photos can be collected now.

## Files

- Photos go in the git-ignored `photos/` folder at the repo root (the repo is public). Name them `<home>-<room>-<n>.jpg`, e.g. `villa-kok-1.jpg`, lower case, no spaces or å/ä/ö.
- `evals/photo/floors/<home>.json`: the floor the photos were taken on, as exported from the editor with the dev-only "Exportera våning" action (T5). It gives the eval the real walls, openings and rooms.
- `evals/photo/manifest.json`: one entry per photo, `{ "file": "villa-kok-1.jpg", "sha256": "…", "home": "villa" }`.
- `evals/photo/facit/<file without .jpg>.json`: the ground truth for one photo:

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

`devices` lists every device of a detectable type (outlet, switch, wall light, ceiling light) that is visible in the photo, also ones already in the model. `count` (sockets in one frame), `props`, `offset` (metres from the wall's `a` end to the device's centre) and `height` (metres from the floor to its centre) are optional: leave out what was not checked. Measured offsets and heights make the placement scores possible.

## What to photograph

30 or more photos: every kitchen wall; walls in other rooms with outlets, switches and lights; some with a door or window in view and some without (the placement then has fewer reference points); a few ceilings. Stand back far enough to see where the wall meets the floor and, ideally, the ceiling. Take a photo of the same wall twice from different angles now and then; the second must not add duplicates.
