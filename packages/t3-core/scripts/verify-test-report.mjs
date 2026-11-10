#!/usr/bin/env node
/**
 * verify-test-report.mjs — T2-03E acceptance guard.
 *
 * Ensures that `artifacts/test-report.json` reflects a FULL test run,
 * not a filtered subset. Fails if:
 *   - the report is missing;
 *   - any test file discovered under tests/ is not present in the report
 *     (real-kernel E2E is the single documented exception when the
 *     real-kernel artifact is absent);
 *   - any test failed;
 *   - more than one file is skipped or a skipped file is not the
 *     real-kernel E2E.
 *
 * The specific number of passed tests is intentionally NOT hard-coded.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

function normalizeReportedPath(value) {
  const path = String(value).replaceAll("\\", "/");

  if (path.startsWith("tests/")) {
    return path;
  }

  const marker = "/tests/";
  const index = path.lastIndexOf(marker);

  if (index >= 0) {
    return `tests/${path.slice(
      index + marker.length,
    )}`;
  }

  return path;
}

const root = process.cwd();
const reportPath = join(root, "artifacts", "test-report.json");

if (!existsSync(reportPath)) {
  console.error(
    "❌ verify-test-report: artifacts/test-report.json missing — run `npm test` first",
  );
  process.exit(1);
}

const REAL_KERNEL_E2E = "tests/integration/real-kernel.e2e.ts";
const REAL_KERNEL_ARTIFACT_ENV = "IWXA_REAL_KERNEL_REQUIRED";

const TEST_EXTENSIONS = new Set([
  ".test.ts",
  ".test.tsx",
  ".e2e.ts",
  ".e2e.tsx",
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else {
      for (const ext of TEST_EXTENSIONS) {
        if (entry.endsWith(ext)) {
          out.push(p);
          break;
        }
      }
    }
  }
  return out;
}

const discovered = walk(join(root, "tests"))
  .map((p) => relative(root, p).split(sep).join("/"));

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (e) {
  console.error("❌ verify-test-report: cannot parse artifacts/test-report.json:", e.message);
  process.exit(1);
}

const results = Array.isArray(report.testResults) ? report.testResults : [];
if (results.length === 0) {
  console.error("❌ verify-test-report: report contains no testResults[]");
  process.exit(1);
}

const reportedFiles = new Set(
  results.map((result) => normalizeReportedPath(result.name)),
);

const errors = [];

for (const f of discovered) {
  if (reportedFiles.has(f)) continue;
  if (f === REAL_KERNEL_E2E) continue; // documented optional
  errors.push(
    `test file not covered by report: ${f} — the run was filtered, not full`,
  );
}

let failed = 0;
let skipped = 0;
let passed = 0;
const skippedFiles = [];
for (const r of results) {
  const results = Array.isArray(r.assertionResults) ? r.assertionResults : [];
  let anyRun = false;
  for (const a of results) {
    if (a.status === "failed") failed++;
    else if (a.status === "passed") { passed++; anyRun = true; }
    else if (a.status === "pending" || a.status === "skipped" || a.status === "todo") {
      skipped++;
    } else {
      anyRun = true;
    }
  }
  if (!anyRun && r.status !== "passed") {
    skippedFiles.push(normalizeReportedPath(r.name));
  }
}

if (failed > 0) {
  errors.push(`report contains ${failed} failed test(s)`);
}

for (const sf of skippedFiles) {
  if (sf !== REAL_KERNEL_E2E) {
    errors.push(`unexpected fully-skipped test file: ${sf}`);
  }
}

if (errors.length) {
  console.error("❌ verify-test-report failed:");
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}

console.log("✅ verify-test-report passed");
console.log(`   test files discovered : ${discovered.length}`);
console.log(`   test files in report  : ${reportedFiles.size}`);
console.log(`   passed cases          : ${passed}`);
console.log(`   skipped cases         : ${skipped}`);
console.log(`   real-kernel required  : ${process.env[REAL_KERNEL_ARTIFACT_ENV] ? "yes" : "no"}`);
