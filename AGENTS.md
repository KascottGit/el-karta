# AGENTS.md

Conventions for anyone (human or agent) changing this repo. `PLAN.md` holds the product plan and milestones; decisions live in `docs/decisions/`.

## Commands

| Command               | What it does                                                                            |
| --------------------- | --------------------------------------------------------------------------------------- |
| `pnpm install`        | Install everything (Node and pnpm versions are pinned in `.nvmrc` and `packageManager`) |
| `pnpm dev`            | Web app on http://localhost:5173                                                        |
| `pnpm build`          | Production build of every app                                                           |
| `pnpm test`           | All Vitest projects (`core`, `web`, `tooling`)                                          |
| `pnpm typecheck`      | `tsc --noEmit` for every package                                                        |
| `pnpm lint`           | ESLint (incl. import boundaries) + Prettier check; `pnpm format` fixes formatting       |
| `pnpm perf`           | Load and tracing timings on the synthetic projects                                      |
| `pnpm supabase start` | Local Supabase stack (needs Docker)                                                     |

Run `pnpm typecheck && pnpm lint && pnpm test` before every commit. CI runs the same plus `pnpm build`.

## Layout and boundaries

- `packages/core`: schemas, geometry, graph and tracing, validators, migrations, plugin interface, repository interface, edit operations, synthetic generator. Plain ESM TypeScript with no Node, browser or Deno APIs; `src` is typechecked without `node` or `dom` types to enforce this. Tests live in `packages/core/test`.
- `packages/plugin-*`: domain logic. May import `@el-karta/core` only.
- `packages/data-*`: repository implementations. May import `@el-karta/core` only.
- `apps/web`: the Vite + React app. May import any package.
- `packages/core` never imports from plugins, data adapters, AI passes, agent tools or apps.

Boundaries are enforced by ESLint (`tooling/eslint/boundaries.js`) and tested in `tooling/eslint/boundaries.test.ts`. Workspace packages export TypeScript source directly (`exports: ./src/index.ts`); there is no package build step.

## Code

- TypeScript strict, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Zod schemas are the single source of truth. Types come from `z.infer`; do not hand-write a type that a schema already defines.
- Minimal comments: only a non-obvious _why_. Never restate what the code does. Decisions go in an ADR, not a comment.
- One way to do each thing. Before adding something that resembles an existing feature, generalize the existing one and use it for both.
- Prefer established libraries over custom code. If you must write custom code where a library could exist, add a short ADR saying why.
- Ask before adding a large dependency or making a breaking change to the data model.
- Identifiers in English. User-facing text in Swedish via i18n keys (`apps/web/src/i18n/sv.json`); never hard-code UI strings.
- Validation issues carry a `code` (e.g. `opening.outside-wall`) that maps to the i18n key `issues.<code>`.

## Data model rules

- Plan coordinates are metres, x right, y down (same as plan images); z is up. Wall `side: 'left'` is left of the a→b direction in those coordinates.
- Every collection in a floor or project document is a record keyed by item id (ADR 0002). Replace array fields (polygons, ports) whole in edits.
- All model changes go through edit operations (`packages/core/src/edits`) applied with `applyEdit`, so they produce Immer patches for undo/redo and sync.
- Patches from anywhere else (undo, redo, remote changes) are applied with `applyModelPatches`, and the graph follows with `LiveGraph.update(next, patches)`. Never rebuild the index or graph per edit; see ADR 0003.
- A connection is stored on its floor when both ports are on that floor, otherwise in `project.data.crossFloorConnections`. Use `addConnection`, which decides.
- Every document has `schemaVersion`. Changing a schema shape means bumping `CURRENT_SCHEMA_VERSION` and adding a migration step with a test.
- AI output is never written to the model directly; it becomes a suggestion a person accepts.

## Tests

- Unit tests for all model, geometry, graph, validator, migration and agent-tool logic. UI tests only where cheap.
- Use `ModelBuilder` (`packages/core/test/builder.ts`) for hand-built fixtures and `generateProject('small' | 'medium' | 'large')` for realistic ones.
- The performance budget in `PLAN.md` is asserted in `packages/core/test/perf.test.ts`. Test against the large synthetic project, not only the small one.

## Database and secrets

- Schema changes only through `supabase/migrations/`. Never edit the schema in the dashboard.
- Never commit `.env.local`, the service role key or AI provider keys. The client only ever gets the anon key.
