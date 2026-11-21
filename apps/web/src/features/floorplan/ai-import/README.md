# AI floor-plan import

"Tolka planritning med AI" (M4 T5, ADR 0007): reads a floor's background image into pending suggestions, which the suggestions review (`features/suggestions`) then shows. It is a floor-editor extension (`extension.ts`): a toolbar action, a panel for progress, the scale question and errors, and a layer that draws nothing but connects the import to the query cache and to scales set with the scale tool.

## Flow

1. **Read** (`flow.ts`, `readPlan`): the shared `readFloorplan` from `@el-karta/ai-passes` (the eval runner uses the same one) locates the plan on the whole page, crops to it, tiles a large crop and reads each tile through the `ai-pass` function's `run`, then merges. Regions are cut from the loaded image with a canvas and sent as PNG, or as JPEG and then at fewer pixels when PNG would not fit the function's 4 MB body cap (`encode.ts`). Nothing is stored while reading; cancel aborts at once and a late answer is ignored.
2. **Interpret** (`interpretReading`) with the floor's background placement, scale and height and, for a rendered PDF page, the page's paper width (`background/pdf-page.ts`, stored beside the attachment at upload, since the PNG does not keep it).
3. **Scale** (M4 decision 2): a printed or kept scale goes straight on. With none, the panel asks "Vet du ett mått?": "Mät ett mått" switches to the scale tool and the import goes on when a scale is set; "Uppskatta åt mig" interprets again allowing an estimate from objects of standard size. A floor whose scale is an estimate shows "Uppskattad skala – kontrollera ett mått" (`background/scale-notice.tsx`) whatever the tool.
4. **Commit** (`commitDrafts`): the reading is saved first, then the drafts go through the function's `commit`, then the previous reading's pending suggestions are rejected (a new import replaces the last one's pending rows), `['suggestions']` is invalidated and the review tool opens.

Errors end the import with a Swedish message (`ai.import.errors.<code>`, mapped in `errors.ts`); a failed or cancelled import stores nothing. The floor stays editable throughout: the panel is not modal.

## Stored readings and stale suggestions

The latest reading of a floor is kept in Storage at `<projectId>/ai-import/<floorId>.json` (`reading.ts`, through `background/project-json.ts`, written with `cacheControl: 0`). Next to the merged model output it lists the suggestions committed on the floor that may still matter (pending ones, and accepted ones of the same image), each with the background placement (including scale) it was measured at. Storage policies already give members read and writers write access, so this needs no table, and it survives reloads and works for every member.

Every commit (`commitDrafts`) first writes the reading with the new suggestions and the old pending ones together, then commits, then rejects the old pending ones. If the commit or the rejection fails, the next replacement still finds the old pending suggestions and rejects them. New drafts that repeat a suggestion accepted from an earlier reading of the same image (same wall ends, or same room name and centre, compared where each lies on the image, moved from its own placement) are left out; an opening on a repeated wall moves onto the accepted wall and requires its suggestion. This applies to a fresh import as well as to a re-interpretation.

When the person sets a scale with the scale tool (`background/scale-events.ts`; undo, redo and remote changes do not count), `reinterpretStored` interprets the stored reading again at the new placement and replaces its pending suggestions, so accepting one never leaves an item at the wrong size. Core's `scale` suggestion kind never overwrites a user scale on accept (M4 decision 2). If the re-interpretation fails, "Försök igen" runs it again without a new AI read.

Issues left after a run's retry (`invalid` runs) are kept with the reading and shown on the scale suggestion, or on every suggestion when there is none.

After a new scale, the scale panel also offers to rescale what is drawn on the floor (`background/rescale.ts`, core `scaleFloor`) about the same point as the image, so accepted items stay on the plan they were traced from.

## Tests

`fixtures.ts` has an in-memory function (`fakeBackend`) and a floor with a background. The e2e test (`e2e/ai-import.spec.ts`) needs the function served with the fake provider and `e2e/fixtures/ai-import.env`, whose reply (`e2e/fixtures/ai-plan-reply.json`) reads `plan.png` as a two-room flat without a printed scale.
