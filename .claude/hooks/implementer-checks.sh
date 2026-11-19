#!/usr/bin/env bash
# SubagentStop hook: an implementer may only finish when typecheck, lint and unit tests pass in its worktree.
set -uo pipefail

input=$(cat)
agent_type=$(jq -r '.agent_type // empty' <<<"$input")
[[ "$agent_type" == "implementer" ]] || exit 0

cwd=$(jq -r '.cwd // empty' <<<"$input")
cd "${cwd:-.}" || exit 0

if output=$( { pnpm typecheck && pnpm lint && pnpm test; } 2>&1 ); then
  exit 0
fi

summary=$(grep -E 'error|Error|FAIL|✖|failed' <<<"$output" | head -40)
if [[ "$(jq -r '.stop_hook_active // false' <<<"$input")" == "true" ]]; then
  # Already blocked once: let the agent stop so it can report, instead of looping.
  jq -n --arg s "$summary" '{systemMessage: ("Implementer finished with failing checks:\n" + $s)}'
  exit 0
fi
printf 'Checks failed in %s. Fix them before finishing, or explain in your report why you cannot.\n%s\n' "$PWD" "$summary" >&2
exit 2
