#!/usr/bin/env bash
# Serves the Edge Functions locally with one env file, replacing a server this script started
# before, and waits until they answer. Integration tests and e2e use different fake providers.
set -euo pipefail
env_file="$1"
log="${2:-functions.log}"
pid_file=".functions-serve.pid"
if [[ -f "$pid_file" ]]; then
  kill "$(cat "$pid_file")" 2>/dev/null || true
  rm -f "$pid_file"
fi
docker stop supabase_edge_runtime_el-karta >/dev/null 2>&1 || true
pnpm supabase functions serve --env-file "$env_file" >"$log" 2>&1 &
echo $! >"$pid_file"
timeout 120 bash -c "until grep -q 'Serving functions' '$log'; do sleep 2; done"
