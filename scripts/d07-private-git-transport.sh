#!/usr/bin/env bash
# Only the owner-authorized, exact private D07 work branch is a destination.
# Called only in a dedicated CI step with GH_TOKEN supplied by existing DOMEN.
set -euo pipefail
set +x
unset GIT_TRACE GIT_TRACE_PACKET GIT_TRACE_CURL GIT_CURL_VERBOSE GIT_TRACE2 GIT_TRACE2_EVENT GH_DEBUG
export GIT_TERMINAL_PROMPT=0
repo=Faust-S/uslugovod.ru
url=https://github.com/Faust-S/uslugovod.ru.git
target=refs/heads/work/2026-11-24-d07-t3
fail() { printf 'D07_T3_PRIVATE_TRANSPORT=%s\n' "$1" >&2; exit 1; }
classify() {
  local file="$1"
  if grep -Eiq 'GH001|large files detected|exceeds GitHub.s file size limit' "$file"; then echo FILE_SIZE
  elif grep -Eiq 'GH006|GH013|repository rule|protected branch|push declined due to repository rule' "$file"; then echo BRANCH_RULE
  elif grep -Eiq 'non-fast-forward|fetch first|stale info' "$file"; then echo HEAD_CONFLICT
  elif grep -Eiq '401|bad credentials|authentication failed|invalid username or token|could not read Username|could not read Password' "$file"; then echo AUTHENTICATION
  elif grep -Eiq '403|write access .*not granted|permission .*denied|resource not accessible|not permitted|insufficient permission' "$file"; then echo WRITE_PERMISSION
  elif grep -Eiq 'repository not found|404' "$file"; then echo REPOSITORY_ACCESS
  elif grep -Eiq 'could not resolve host|failed to connect|connection reset|timed out|TLS|SSL' "$file"; then echo NETWORK
  else echo UNCLASSIFIED
  fi
}
mode="${1:-}"
expected="${2:-}"
if [[ "$mode" == classify ]]; then
  [[ -f "$expected" ]] || fail CLASSIFY_INPUT
  classify "$expected"
  exit 0
fi
[[ "$mode" == preflight || "$mode" == publish ]] || fail MODE
[[ "$expected" =~ ^[0-9a-f]{40}$ ]] || fail EXPECTED_HEAD
[[ -n "${GH_TOKEN:-}" ]] || fail EXISTING_TOKEN_MISSING
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Use gh's official credential helper rather than the runner's default
# GITHUB_TOKEN or a cached HTTP extraheader from a different checkout.
git_private() {
  git -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
    -c http.extraheader= -c http.https://github.com/.extraheader= "$@"
}
if ! gh api "repos/$repo" --jq '[.private, (if .permissions.push == null then "unknown" else .permissions.push end)] | @tsv' > "$tmp/repo" 2> "$tmp/api"; then
  fail "API_$(classify "$tmp/api")"
fi
IFS=$'\t' read -r private push < "$tmp/repo"
[[ "$private" == true ]] || fail DESTINATION_NOT_PRIVATE
printf 'D07_T3_PRIVATE_API_PUSH=%s\n' "$([[ "$push" == true ]] && echo TRUE || { [[ "$push" == false ]] && echo FALSE || echo UNKNOWN; })"
remote_head() {
  local output
  if ! output="$(git_private ls-remote --exit-code "$url" "$target" 2> "$tmp/remote")"; then
    fail "READ_$(classify "$tmp/remote")"
  fi
  [[ "$output" =~ ^([0-9a-f]{40})[[:space:]]refs/heads/work/2026-11-24-d07-t3$ ]] || fail READBACK_FORMAT
  printf '%s\n' "${BASH_REMATCH[1]}"
}
observed="$(remote_head)" || exit 1
[[ "$observed" == "$expected" ]] || fail HEAD_CONFLICT
if [[ "$mode" == preflight ]]; then
  [[ "$(git rev-parse HEAD)" == "$expected" ]] || fail LOCAL_HEAD
  # No reference or file is changed by this operation.
  if ! git_private push --dry-run "$url" "HEAD:$target" > "$tmp/push" 2>&1; then
    fail "DRY_RUN_$(classify "$tmp/push")"
  fi
  printf 'D07_T3_PRIVATE_RECEIVE_PACK=PASS\n'
  exit 0
fi
candidate="${3:-}"
[[ "$candidate" =~ ^[0-9a-f]{40}$ && "$candidate" != "$expected" ]] || fail CANDIDATE
[[ "$(git rev-parse HEAD)" == "$candidate" ]] || fail LOCAL_HEAD
git merge-base --is-ancestor "$expected" "$candidate" || fail NOT_FAST_FORWARD
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail TRACKED_SOURCE_DIRTY
# Never force or push any additional branch/tag. If the remote changed after
# preflight Git itself must reject the non-fast-forward.
if ! git_private push "$url" "HEAD:$target" > "$tmp/push" 2>&1; then
  fail "PUSH_$(classify "$tmp/push")"
fi
observed="$(remote_head)" || exit 1
[[ "$observed" == "$candidate" ]] || fail POST_PUSH_READBACK
printf 'D07_T3_PRIVATE_RETAINED_COMMIT=%s\n' "$candidate"
printf 'D07_T3_PRIVATE_TRANSPORT=PASS\n'
