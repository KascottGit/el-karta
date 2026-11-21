# Floor-plan evals

`manifest.json` lists the plans (images are git-ignored in `floorplans/`, checked by `sha256`). `facit/<id>.json` is the ground truth:

- `level: "light"`: read off the plan by hand. Rooms with their name as printed (`null` if unlabelled), the room types that count as correct, the printed area if any; the number of doors (wardrobe and cupboard doors excluded; a double door counts once); `windows` is left out until someone counts them.
- `scale.metresPerImageWidth`: the real-world width the whole page covers, so it holds at any render resolution. `null` when the plan prints nothing to derive it from.
- `rotationDeg`: how far the plan's walls are turned from the page axes.
- `checked`: set to `true` once a person has checked the facit against the plan.

A full facit (`level: "full"`) adds the corrected floor exported from the editor.
