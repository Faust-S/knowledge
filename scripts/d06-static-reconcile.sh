#!/usr/bin/env bash
# Replay only the remaining generated-route and static build checks.
# Prior exact check/test/E2E/native witnesses are validated by the release workflow.
# Private source, paths and logs remain on the runner. Do not reset the Host checkout.
set -euo pipefail
expected="${1:-}"
helper="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/d06-verify-generated-routes.cjs"
[[ -f "$helper" ]] || { echo D06_STATIC_RECONCILE_HELPER=FAIL; exit 1; }
[[ "$expected" =~ ^[0-9a-f]{40}$ ]] || { echo D06_STATIC_RECONCILE_PIN=FAIL; exit 1; }
[[ "$(git rev-parse HEAD)" == "$expected" && -z "$(git status --porcelain --untracked-files=all)" ]] || { echo D06_STATIC_RECONCILE_ORIGINAL=FAIL; exit 1; }
[[ -d node_modules && -n "${RUNNER_TEMP:-}" ]] || { echo D06_STATIC_RECONCILE_INPUT=FAIL; exit 1; }
root="$(mktemp -d "$RUNNER_TEMP/d06-static-reconcile.XXXXXX")"
work="$root/site"
log="$root/private.log"
cleanup() {
  if [[ -e "$work/.git" ]]; then
    git worktree remove --force "$work" > "$root/remove.private.log" 2>&1 || return 1
  fi
  rm -rf -- "$root"
}
trap 'cleanup || echo D06_STATIC_RECONCILE_CLEANUP=FAIL' EXIT
git worktree add --detach "$work" "$expected" > "$log" 2>&1 || { echo D06_STATIC_RECONCILE_WORKTREE=FAIL; exit 1; }
ln -s "$(realpath node_modules)" "$work/node_modules"
[[ "$(git -C "$work" rev-parse HEAD)" == "$expected" ]] || { echo D06_STATIC_RECONCILE_WORKTREE_PIN=FAIL; exit 1; }
source_clean() {
  node --input-type=module - "$work" "$1" "$helper" <<'NODE'
import { execFileSync } from "node:child_process";
const [cwd, stage, helper] = process.argv.slice(2);
const git = (...args) => execFileSync("git", args, {cwd, encoding:"utf8", maxBuffer: 16*1024*1024});
const tokens = s => s.split("\0").filter(Boolean);
const tracked = tokens(git("diff", "--name-only", "-z", "HEAD"));
const untracked = tokens(git("ls-files", "--others", "--exclude-standard", "-z"));
const generated = /^(?:dist|dist-ssr|\.output|\.tanstack|\.nitro|\.native-build|\.reports|test-results|playwright-report|\.tmp-server|logs)(?:\/|$)/;
const unknown = untracked.filter(path => !generated.test(path));
console.log("D06_STATIC_RECONCILE_COUNTS=" + [stage, tracked.length, untracked.length, unknown.length].join(":"));
const generatedRoute = ["build_static", "check_type", "check_static"].includes(stage) &&
  tracked.length === 1 && tracked[0] === "src/routeTree.gen.ts";
if (tracked.length && !generatedRoute) {
  const inventory = tokens(git("ls-files", "-z")).sort();
  const ordinals = tracked.map(path => inventory.indexOf(path) + 1).filter(n => n > 0).sort((a,b)=>a-b);
  for (const ordinal of ordinals.slice(0,32)) console.log("D06_STATIC_TRACKED_ORDINAL=" + stage + ":" + ordinal);
}
if (unknown.length || (tracked.length && !generatedRoute)) process.exit(1);
if (generatedRoute) {
  execFileSync(process.execPath, [helper, cwd], {stdio:"inherit"});
  console.log("D06_STATIC_RECONCILE_GENERATED_ROUTE=PASS");
}
NODE
}
source_clean START
for task in build:static check:type check:static; do
  stage="${task//:/_}"
  if ! (cd "$work" && npm run "$task") > "$log" 2>&1; then
    echo "D06_STATIC_RECONCILE_COMMAND=$stage:FAIL"
    grep -Eo 'TS[0-9]{4}|D06_[A-Z0-9_]+' "$log" | sort -u | head -20 || true
    exit 1
  fi
  echo "D06_STATIC_RECONCILE_COMMAND=$stage:PASS"
  source_clean "$stage" || { echo D06_STATIC_RECONCILE_SOURCE=FAIL; exit 1; }
done
[[ "$(git rev-parse HEAD)" == "$expected" && -z "$(git status --porcelain --untracked-files=all)" ]] || { echo D06_STATIC_RECONCILE_ORIGINAL=FAIL; exit 1; }
cleanup || { echo D06_STATIC_RECONCILE_CLEANUP=FAIL; exit 1; }
trap - EXIT
echo D06_STATIC_RECONCILE_ORIGINAL=PASS
echo D06_STATIC_RECONCILE_SOURCE=PASS
