// Resume only the exact frozen D06 product witness. Never emit raw runner logs.
// The original site command passed; its post-command checkout cleanliness did not.
// This does not accept Host, Exchange, retention or production delivery.
import { readFileSync } from "node:fs";
function verifyPriorRelease(run, job, log) {
  const require = (condition, code) => {
    if (!condition) throw new Error("D06_RESUME_" + code);
  };
  require(run.id === 45669214673 &&
    run.head_sha === "81c1675ab15af4b014527abcb4509bb78479b501" &&
    run.run_attempt === 1 &&
    run.path === ".github/workflows/d06-t3-release-gate.yml" &&
    run.status === "completed" && run.conclusion === "failure", "RUN_IDENTITY");
  require(job.id === 139399590758 && job.run_id === run.id &&
    job.name === "final-release-closure" &&
    job.status === "completed" && job.conclusion === "failure" &&
    (job.head_sha === undefined || job.head_sha === run.head_sha) &&
    (job.run_attempt === undefined || job.run_attempt === 1), "JOB_IDENTITY");
  const step = (name, conclusion) =>
    job.steps.filter(s => s.name === name && s.status === "completed" &&
      s.conclusion === conclusion).length === 1;
  for (const name of [
    "Validate explicit release request",
    "Reuse exact successful hardware model witness",
    "Verify immutable candidate revisions",
    "Prove exact canonical projection",
    "Check exact original assistant files and owner pack",
    "Validate canonical procedures, original runtime and extraction",
    "Install site dependencies once",
    "Check original React source bindings and idempotent import",
    "Prove 1.3 to 1.4.1 upgrade only with exact new result bindings",
    "Install fixed Chromium only in the qualification environment",
    "Verify original public portable input",
  ]) require(step(name, "success"), "PRIOR_STEP");
  require(step("Exact mandatory site gate", "failure") &&
    step("Prepare compiled loopback Host", "failure"), "EXPECTED_CLOSURE_FAILURE");
  const lines = log.split(/\r?\n/).flatMap(raw => {
    const match = raw.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z (.*)$/);
    return match && !match[1].includes("\x1b") && match[1].trim() ? [match[1].trim()] : [];
  });
  const mark = value => {
    const index = lines.indexOf(value);
    require(index >= 0 && lines.lastIndexOf(value) === index, "MARKER");
    return index;
  };
  let previous = -1;
  for (const marker of [
    "D06_RELEASE_REQUEST=PASS",
    "D06_FINAL_PRIOR_HARDWARE_TEST_ONLY_DELTA=PASS",
    "D06_FINAL_EXACT_PRIOR_HARDWARE_MODEL=PASS",
    "D06_RELEASE_EXACT_PINS=PASS",
    "D06_PD12_OWNER_PROJECTION=PASS",
    "D06_PD12_CANONICAL_CASES=70",
    "D06_PD12_CANONICAL_SELECTION_CASES=63",
    "D06_CURRENT_PURCHASE_DECISION_CASES=51",
    "D06_T3_SKILL_RELEASE_PIN=PASS",
    "D06_T3_ORIGINAL_INPUTS=PASS",
    "D06_T3_FACT_ABSTENTION_CASES=50",
    "D06_T3_RESULT_CONTEXT_CASES=119",
    "D06_T3_SKILLS_SOURCE=PASS",
    "D06_RELEASE_NPM_CI=PASS",
    "D06_T3_SKILLS_PROJECTION=PASS",
    "D06_T3_PINNED_SERIALIZER_TEST=PASS",
    "D06_T3_IMPORT_DRY_RUN=PASS",
    "D06_T3_IMPORT_IDEMPOTENT=PASS",
    "D06_T3_SKILL_UPGRADE_REJECTS_MISSING_BINDINGS=PASS",
    "D06_T3_SKILL_UPGRADE=PASS",
    "D06_T3_SKILL_UPGRADE_COMMITTED_BYTES=PASS",
    "D06_FINAL_BROWSER_VERSION=156.0.8078.4",
    "D06_FINAL_BROWSER_INSTALL=PASS",
    "D06_E2E_STRUCTURED=PASS",
    "D06_E2E_COUNTS=85:0:0:0",
    "D06_E2E_OMITTED=0",
    "D06_T3_ORIGINAL_PLATFORM_128_FILES=PASS",
    "D06_T3_HOST_SOURCE_BUILD=FAIL",
    "D06_T3_HOST_SITE_CHECKOUT_DIRTY",
  ]) {
    const next = mark(marker);
    require(next > previous, "MARKER_ORDER");
    previous = next;
  }
  require(!lines.some(line => /^(?:D06_E2E_FAILURE=|D06_FULL_RUN_BUILD_STATIC_CHECK=)/.test(line)),
    "STATIC_PRODUCT_FAILURE");
  const end = lines.indexOf("D06_E2E_OMITTED=0");
  // Exact old script: a nonzero npm exit prints the FAIL marker before exit.
  // With the report present and all 85 expected, the next exit 1 was the
  // post-command clean-worktree assertion, not a failed product scenario.
  require(lines[end - 2] === "D06_E2E_STRUCTURED=PASS" &&
    lines[end - 1] === "D06_E2E_COUNTS=85:0:0:0" &&
    lines[end + 1] === "##[error]Process completed with exit code 1.", "STATIC_EXIT_BOUNDARY");
  return true;
}

try {
  const args=process.argv.slice(2);
  if(args.length!==3)throw Error("D06_RESUME_USAGE");
  verifyPriorRelease(JSON.parse(readFileSync(args[0],"utf8")),JSON.parse(readFileSync(args[1],"utf8")),readFileSync(args[2],"utf8"));
  console.log("D06_PRIOR_EXACT_STATIC_PRODUCT_EVIDENCE=PASS");
  console.log("D06_PRIOR_E2E_COUNTS=85:0:0:0");
  console.log("D06_PRIOR_STATIC_CLEANLINESS=FAIL");
} catch (error) {
  const code=String(error?.message??"");
  console.error(/^D06_RESUME_[A-Z_]+$/.test(code)?code:"D06_RESUME_EVIDENCE_INVALID");
  process.exitCode=1;
}
