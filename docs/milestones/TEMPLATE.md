# M<n> – <title>

Status: **draft, awaiting approval**. Milestone branch: `m<n>-<slug>`.

From PLAN.md: <copy only this milestone's text and "Done when">.

## Design decisions for this milestone (approve with the plan)

1. …

## Shared building blocks

Modules several tasks will need: UI fields, snapping or geometry helpers, validation access, i18n sections, e2e helpers, store additions. For each, say where it lives and whether it already exists. Anything new here is built by the orchestrator in T0, before parallel tasks start.

| Building block | Location | Exists? | Used by |
| -------------- | -------- | ------- | ------- |

## Tasks

Common acceptance for every task:

- `pnpm typecheck && pnpm lint && pnpm test` pass.
- New logic has unit tests.
- UI text is Swedish via i18n keys.
- UI works with touch on a 390×844 viewport, with an e2e test.
- The implementer's pre-finish checklist (`.claude/agents/implementer.md`) is done.

### T0 – Setup (orchestrator)

- Dependencies, routes, and the new shared building blocks above.

### T1 – …

- **Depends on:**
- **Touches:**
- **Read:** <only the ADRs and READMEs needed>
- **Goal:**
- **Acceptance:**
- **Out of scope:**

## Order and parallelism

At most two agents run at a time (ADR 0005). List the order, dependencies first, and which tasks can pair (disjoint Touches).
