#!/usr/bin/env bash
# Check only the already authorized private source metadata; never print raw
# API stderr, token, repository contents or change permissions.
set -euo pipefail
marker="${1:?missing result marker}"
shift
if [ -z "${GH_TOKEN:-}" ]; then
  printf '%s=UNAVAILABLE\n' "$marker"
  exit 1
fi
if [ "$#" -eq 0 ]; then
  printf '%s=NO_REPOSITORIES\n' "$marker"
  exit 1
fi
log="$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/d04-access.XXXXXX")"
trap 'rm -f -- "$log"' EXIT
for repo in "$@"; do
  ok=0
  for attempt in 1 2 3 4; do
    if gh api "repos/$repo" --jq '.id' >/dev/null 2>"$log"; then
      ok=1
      break
    fi
    code="$(grep -Eo 'HTTP [0-9]{3}' "$log" | head -1 || true)"
    printf '%s_CHECK_FAILED repo=%s attempt=%s status=%s\n' "$marker" "$repo" "$attempt" "${code:-UNKNOWN}"
    if [ "$attempt" -lt 4 ]; then
      sleep "$((attempt * 3))"
    fi
  done
  if [ "$ok" -ne 1 ]; then
    printf '%s=DENIED repo=%s\n' "$marker" "$repo"
    exit 1
  fi
done
printf '%s=PASS\n' "$marker"
