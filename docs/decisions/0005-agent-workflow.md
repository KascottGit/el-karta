# 0005 Sub-agent workflow

Status: accepted (after M2)

## Decision

Development from M3 on runs as one orchestrator session plus two sub-agent types defined in `.claude/agents/`, all on Opus:

- **Orchestrator** (the main Claude Code session): splits a milestone into tasks in `docs/milestones/M<n>.md`, gets the person's approval of that plan, starts implementers, sends each finished branch to a reviewer, sends findings back, merges approved task branches into the milestone branch, runs every check including the Supabase suites and the performance test, and opens one PR per milestone. It stops at each milestone for the person's review, as PLAN.md requires. It does the small shared setup itself (dependencies, routes) so that tasks don't collide.
- **implementer**: one task, in its own git worktree branched from the milestone branch (`worktree.baseRef: head`), on branch `m<n>/t<k>-<slug>`. It stays inside the task's "Touches" list, writes tests, commits, and reports in a fixed format. It never pushes, adds dependencies, or touches the hosted project.
- **reviewer**: read-only review of one task branch against the spec, AGENTS.md, the ADRs and the design principles. It returns a verdict and ranked findings.

## Guardrails

- `.claude/settings.json`:
  - allows the routine pnpm, git and gh read commands;
  - asks the person only before merging a PR; the orchestrator pushes and opens PRs, adds approved dependencies and runs Supabase commands without asking (changed after M3 at the person's request);
  - denies reading `.env` files, including `supabase/functions/.env` with the AI provider key.
- A `SubagentStop` hook (`.claude/hooks/implementer-checks.sh`) runs typecheck, lint and unit tests in the implementer's worktree and blocks it from finishing while they fail (once; the second time it lets the agent stop and report).
- The local Supabase stack is shared by all worktrees: only the orchestrator starts or resets it, and parallel e2e runs use different `E2E_PORT`s.

## Why

Each sub-agent starts without the conversation's context, so the repo itself (AGENTS.md, ADRs, the milestone spec) has to carry everything it needs, which also keeps the codebase agent-friendly. A separate reviewer catches what the author misses. Tasks with disjoint "Touches" lists run in parallel; tightly coupled UI work stays sequential.

## Amendment after M3: token efficiency

M3 hit the usage limit several times, mostly from four parallel Opus agents, and from fix rounds that resumed agents whose context had grown to 250k+ tokens after the default 5-minute prompt cache had expired. From M4 on:

- **Cache and concurrency.** Sub-agents use a 1-hour prompt cache (`subagentPromptCacheTtl` in `.claude/settings.json`), so resuming an agent for review fixes reads its context from cache. One agent runs at a time (Pro plan; changed from two during M4); four parallel Opus agents exhausted the 5-hour limit in about 2–3 hours.
- **Plan shared code up front.** Most review findings were duplicates built in parallel: numeric fields, snapping, issue lists, i18n sections. Milestone plans (`docs/milestones/TEMPLATE.md`) now have a "Shared building blocks" section, built in T0.
- **Pre-finish checklist.** Implementers run a checklist for the other recurring findings: touch e2e, documented conventions, tests that fail when a mechanism is removed.
- **Read less.** Agents read AGENTS.md (which now carries the design principles) and the task's named docs, not all of PLAN.md.
- **Re-review only when needed.** After fixes, the orchestrator verifies the diff itself. A second full review only happens when a blocker touched shared infrastructure.
- **Session per milestone.** One orchestrator session per milestone; the next milestone starts fresh from the milestone file and the PR.
