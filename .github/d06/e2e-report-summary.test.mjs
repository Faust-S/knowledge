import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeE2E, formatE2ESummary } from "./e2e-report-summary.mjs";

const files = ["tests/e2e/z.spec.ts", "tests/e2e/a.spec.ts"];
const fixture = (item, spec = {}) => ({
  stats: { expected: 1, unexpected: 1, flaky: 0, skipped: 0 },
  suites: [{ file: "a.spec.ts", suites: [{ specs: [{ line: 20, tests: [item], ...spec }] }] }],
});
const failed = (message, stack, extra = {}) => ({
  status: "unexpected", projectName: "mobile",
  results: [{ status: "failed", retry: 0, errors: [{ message, stack }], ...extra }],
});
test("exact private stack coordinates and disabled-control classification", () => {
  const report = fixture(failed("secret text; element is not enabled",
    "at run (D:\\private\\tests\\e2e\\a.spec.ts:43:7)"));
  const result = summarizeE2E(report, files);
  assert.deepEqual(result.failures, [{ spec: 1, declaration: 20, line: 43, column: 7,
    project: "mobile", kind: "DISABLED", retry: 0 }]);
  const output = formatE2ESummary(result);
  assert.match(output, /D06_E2E_FAILURE=1:20:43:7:mobile:DISABLED:0/);
  assert.doesNotMatch(output, /secret text|private|\.spec\.ts/);
});
test("expected failures are not unexpected regression failures", () => {
  const report = fixture({ ...failed("expected", ""), status: "expected" });
  assert.equal(summarizeE2E(report, files).failures.length, 0);
});
test("unknown file and project do not disclose names", () => {
  const report = fixture({ ...failed("private title", "at c.spec.ts:34:1"),
    projectName: "sensitive-project" }, { file: "c.spec.ts" });
  report.suites[0].file = "unknown.spec.ts";
  const result = summarizeE2E(report, files);
  assert.equal(result.failures[0].spec, 0);
  assert.equal(result.failures[0].project, "other");
  assert.equal(result.failures[0].line, 0);
  assert.doesNotMatch(formatE2ESummary(result), /sensitive|private title|unknown/);
});
test("error location, overflow and timeout are independently classified", () => {
  const item = failed("horizontal overflow detected", "");
  item.results[0].errors[0].location = { file: "/private/tests/e2e/a.spec.ts", line: 27, column: 2 };
  const a = summarizeE2E(fixture(item), files).failures[0];
  assert.equal(a.kind, "OVERFLOW");
  assert.equal(a.line, 27);
  const b = summarizeE2E(fixture(failed("test timed out", "", { status: "timedOut" })), files);
  assert.equal(b.failures[0].kind, "TIMEOUT");
});
test("bounded diagnostics and invalid report rejection", () => {
  const report = fixture(failed("other", ""));
  report.suites[0].suites[0].specs[0].tests = Array.from({ length: 45 }, () => failed("other", ""));
  const summary = summarizeE2E(report, files);
  assert.equal(summary.failures.length, 40);
  assert.equal(summary.omitted, 5);
  assert.throws(() => summarizeE2E({}, files), /D06_E2E_REPORT_INVALID/);
});
