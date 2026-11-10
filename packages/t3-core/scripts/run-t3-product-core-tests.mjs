#!/usr/bin/env node
// T3 runtime/product regression: all original T2 Node tests that do not rely
// on former T2-only repository layout or archived product authority records.
// Unchanged original runner remains: npm run test:core. Do not call this a full
// T2 archival-suite acceptance. Explicit excluded files are reported.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const excluded = new Set([
  "active-product-development-governance.test.mjs",
  "c1-cap033-authority-quarantine.test.mjs",
  "c1-capability-materialization-audit.test.mjs",
  "c1-foundation-duplication-provenance-audit.test.mjs",
  "c1-recovered-authority-binding.test.mjs",
  "c2-dashboard-current-surface.test.mjs",
  "c3-current-product-qualification-receipt.test.mjs",
  "c3-k035-d4-activation-preflight.test.mjs",
  "c3-p4-canonical-path-lineage.test.mjs",
  "c3-p4-connectivity-lineage.test.mjs",
  "c3-p4-context-chain-lineage.test.mjs",
  "c3-p4-traversal-lineage.test.mjs",
  "c3-project-process-activation-binding-plan.test.mjs",
  "c3-project-process-activation-receipt.test.mjs",
  "c3-project-process-authority-recovery.test.mjs",
  "c3-project-process-post-binding-qualification.test.mjs",
  "c3-result-acceptance-authority.test.mjs",
  "current-live-head.test.mjs",
  "factory2-completeness.test.mjs",
  "factory2-control-plane-mapping.test.mjs",
  "factory2-control-plane-runtime.test.mjs",
  "factory2-control-plane-successors.test.mjs",
  "factory2-distribution-control.test.mjs",
  "factory2-exact-windows-toolchain-bootstrap.test.mjs",
  "factory2-finalization-control.test.mjs",
  "factory2-k035-source-materializer.test.mjs",
  "factory2-neutral-acceptance-bootstrap.test.mjs",
  "factory2-release-control.test.mjs",
  "factory2-self-contained-definition.test.mjs",
  "factory2-staging-assembler.test.mjs",
  "github-actions-manual-only.test.mjs",
  "k035-c3-critical-path-status.test.mjs",
  "k035-current-stage-d-executor-contract.test.mjs",
  "k035-current-subject-acceptance-evidence.test.mjs",
  "k035-current-subject-acceptance-lock.test.mjs",
  "k035-current-subject-d4.test.mjs",
  "k035-product-graph-current-authority.test.mjs",
  "k035-r11-preacceptance-closure.test.mjs",
  "k035-rc20-current-source-input.test.mjs",
  "k035-source-candidate-current-packaging.test.mjs",
  "k035-tool-module-smoke.test.mjs",
  "k036-qualified-import-timestamp-release.test.mjs",
  "source-preflight-ci.test.mjs",
  "t2-tier-boundary.test.mjs",
  "t25-capability-closure-matrix.test.mjs",
  "t25-current-coverage-guard.test.mjs"
]);
if (process.argv.length !== 2) {
  console.error("T3_PRODUCT_TEST_UNKNOWN_ARGUMENTS");
  process.exit(2);
}
const all = readdirSync(join(root, "tests"), { withFileTypes: true })
  .filter(x => x.isFile() && x.name.endsWith(".test.mjs"))
  .map(x => x.name).sort();
const archived = all.filter(name => excluded.has(name));
if (archived.length !== excluded.size) {
  console.error("T3_ARCHIVAL_TEST_SET_MISMATCH", [...excluded].filter(n=>!all.includes(n)));
  process.exit(2);
}
const selected = all.filter(name => !excluded.has(name));
if (!selected.length) {
  console.error("T3_PRODUCT_TEST_SET_EMPTY");
  process.exit(2);
}
console.log("T3_PRODUCT_NODE_SELECTED", selected.length,
            "T2_NONPORTABLE_ARCHIVAL_FILES", archived.length);
console.log("T2_NONPORTABLE_ARCHIVAL_FILENAMES", JSON.stringify(archived));
const result = spawnSync(process.execPath,
  ["--test", ...selected.map(name=>join(root,"tests",name))],
  {cwd:root,stdio:"inherit",shell:false});
if(result.error)console.error("T3_PRODUCT_CORE_RUNNER_ERROR",result.error.message);
process.exit(result.status??1);
