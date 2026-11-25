#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
transport="$here/d07-private-git-transport.sh"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
check(){
 printf '%s\n' "$1" > "$temp/message"
 [[ "$(bash "$transport" classify "$temp/message")" == "$2" ]]
}
check 'remote: GH001: Large files detected.' FILE_SIZE
check 'remote: GH013: Repository rule violations found.' BRANCH_RULE
check 'rejected non-fast-forward' HEAD_CONFLICT
check 'fatal: Authentication failed' AUTHENTICATION
check 'remote: Write access to repository not granted. HTTP 403' WRITE_PERMISSION
check 'remote: Repository not found.' REPOSITORY_ACCESS
check 'fatal: Could not resolve host' NETWORK
check 'unexpected private details never printed' UNCLASSIFIED
echo D07_T3_TRANSPORT_CLASSIFICATION=8/8

# Exercise the actual transport against a disposable bare Git repository.
# The GitHub metadata endpoint is a test double; all Git operations, branch
# updates and non-fast-forward rules are real. Only file transport is allowed.
export GIT_CONFIG_GLOBAL="$temp/gitconfig"
export GIT_CONFIG_NOSYSTEM=1 GIT_ALLOW_PROTOCOL=file
export GH_TOKEN=fixture-only
git config --global user.name 'D07 Transport Test'
git config --global user.email 'd07-test@example.invalid'
git config --global init.defaultBranch fixture
remote="$temp/remote.git"
local="$temp/local"
branch=work/2026-11-24-d07-t3
target="refs/heads/$branch"
git init --bare --quiet "$remote"
git init --quiet "$local"
git -C "$local" checkout -q -b "$branch"
printf 'source\n' > "$local/source.txt"
printf '* text=auto\n' > "$local/.gitattributes"
git -C "$local" add source.txt .gitattributes
git -C "$local" commit --quiet -m source
git -C "$local" push --quiet "$remote" "HEAD:$target"
base="$(git -C "$local" rev-parse HEAD)"
git config --global "url.file://$remote.insteadOf" https://github.com/Faust-S/uslugovod.ru.git
mkdir "$temp/bin"
cat > "$temp/bin/gh" <<'GH'
#!/bin/sh
if [ "${1:-}" = api ] && [ "${2:-}" = --method ] && [ "${3:-}" = POST ]; then
  case "${D07_TEST_GH_BLOB_MODE:-denied}" in
    allowed) printf '%s\n' "$D07_TEST_BLOB_SHA"; exit 0 ;;
    *) printf 'HTTP 403\n' >&2; exit 1 ;;
  esac
fi
case "${D07_TEST_GH_MODE:-private}" in
  private) printf 'true\ttrue\n' ;;
  public) printf 'false\ttrue\n' ;;
  denied) printf 'HTTP 403\n' >&2; exit 1 ;;
  *) exit 9 ;;
esac
GH
chmod +x "$temp/bin/gh"
export PATH="$temp/bin:$PATH"
cd "$local"
remote_sha(){ git --git-dir="$remote" rev-parse "$target"; }
expect_fail(){
  local marker="$1"; shift
  if "$@" > "$temp/result" 2>&1; then
    echo D07_TRANSPORT_EXPECTED_FAILURE_MISSING >&2
    exit 1
  fi
  grep -Fx "D07_T3_PRIVATE_TRANSPORT=$marker" "$temp/result" > /dev/null
}
expect_fail EXISTING_TOKEN_MISSING env GH_TOKEN= bash "$transport" preflight "$base"
expect_fail DESTINATION_NOT_PRIVATE env D07_TEST_GH_MODE=public bash "$transport" preflight "$base"
expect_fail API_WRITE_PERMISSION env D07_TEST_GH_MODE=denied bash "$transport" preflight "$base"
bash "$transport" preflight "$base" > "$temp/preflight"
grep -Fx D07_T3_PRIVATE_RECEIVE_PACK=PASS "$temp/preflight" > /dev/null
[[ "$(remote_sha)" == "$base" ]]
printf 'prepared bytes\n' > retained.txt
git add retained.txt
git commit --quiet -m retained
printf 'ordinary build\n' > build.txt
git add build.txt
git commit --quiet -m activated
candidate="$(git rev-parse HEAD)"
# A server-side branch policy can reject an otherwise allowed dry-run.
cat > "$remote/hooks/pre-receive" <<'HOOK'
#!/bin/sh
echo 'GH013: Repository rule violations found.' >&2
exit 1
HOOK
chmod +x "$remote/hooks/pre-receive"
expect_fail PUSH_BRANCH_RULE bash "$transport" publish "$base" "$candidate"
[[ "$(remote_sha)" == "$base" ]]
rm "$remote/hooks/pre-receive"
bash "$transport" publish "$base" "$candidate" > "$temp/published"
grep -Fx "D07_T3_PRIVATE_RETAINED_COMMIT=$candidate" "$temp/published" > /dev/null
grep -Fx D07_T3_PRIVATE_TRANSPORT=PASS "$temp/published" > /dev/null
[[ "$(remote_sha)" == "$candidate" ]]
expect_fail HEAD_CONFLICT bash "$transport" preflight "$base"
[[ "$(remote_sha)" == "$candidate" ]]
echo D07_T3_TRANSPORT_REAL_GIT=8/8

# Separate diagnostic unit: simulate GitHub's smart-HTTP permission refusal,
# then test the official API probe's two bounded outcomes. Actual Git is
# still used for source checkout, blob identity and remote readback.
export D07_TEST_REAL_GIT="$(command -v git)"
export D07_TEST_BLOB_SHA="$(git rev-parse HEAD:.gitattributes)"
cat > "$temp/bin/git" <<'GIT'
#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = --dry-run ]; then
    printf 'remote: Write access to repository not granted. HTTP 403\n' >&2
    exit 1
  fi
done
exec "$D07_TEST_REAL_GIT" "$@"
GIT
chmod +x "$temp/bin/git"
for mode in allowed denied; do
  expect_fail DRY_RUN_WRITE_PERMISSION env D07_TEST_GH_BLOB_MODE="$mode" bash "$transport" preflight "$candidate"
  if [[ "$mode" == allowed ]]; then
    grep -Fx D07_T3_PRIVATE_API_CONTENTS_WRITE=PASS "$temp/result" >/dev/null
  else
    grep -Fx D07_T3_PRIVATE_API_CONTENTS_WRITE=WRITE_PERMISSION "$temp/result" >/dev/null
  fi
  [[ "$(remote_sha)" == "$candidate" ]]
done
echo D07_T3_TRANSPORT_PERMISSION_DIAGNOSIS=2/2
