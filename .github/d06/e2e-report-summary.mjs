import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Private report data must never be copied to public CI output.
// Only fixed labels and numeric coordinates into an exact tracked inventory.
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
const coord = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);

function knownFile(value, files) {
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll("\\", "/");
  const matches = files.filter((file) =>
    normalized === file ||
    normalized.endsWith("/" + file) ||
    normalized === file.slice("tests/e2e/".length)
  );
  return matches.length === 1 ? matches[0] : null;
}

function category(errors, result) {
  const message = errors.map((e) => String(e?.message ?? "")).join("\n");
  if (/element is not enabled|waiting for element to be enabled/i.test(message)) return "DISABLED";
  if (/horizontal overflow detected/i.test(message)) return "OVERFLOW";
  if (/waitForURL|navigation timeout/i.test(message)) return "NAVIGATION";
  if (/toBeEnabled|toBeDisabled/i.test(message)) return "ENABLED";
  if (/toBeVisible|toBeHidden/i.test(message)) return "VISIBLE";
  if (/toHaveCount|toHaveLength/i.test(message)) return "COUNT";
  if (/locator\.click|\.click\(/i.test(message)) return "CLICK";
  if (/toHaveAttribute|toHaveValue|toContainText|AssertionError|expect\(/i.test(message)) return "ASSERTION";
  if (result.status === "timedOut" || /timeout/i.test(message)) return "TIMEOUT";
  if (result.status === "interrupted") return "INTERRUPTED";
  return "OTHER";
}

export function summarizeE2E(report, inventory) {
  if (!report || !Array.isArray(report.suites) || !report.stats) {
    throw new Error("D06_E2E_REPORT_INVALID");
  }
  const files = [...new Set(inventory.filter((file) =>
    /^tests\/e2e\/[A-Za-z0-9._/-]+\.spec\.ts$/.test(file)
  ))].sort();
  const failures = [];
  function visit(suite, inherited) {
    if (!suite || typeof suite !== "object") return;
    const suiteFile = knownFile(suite.file, files) ?? inherited;
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      const file = knownFile(spec.file ?? spec.location?.file, files) ?? suiteFile;
      for (const item of Array.isArray(spec.tests) ? spec.tests : []) {
        if (item.status !== "unexpected" && item.status !== "flaky") continue;
        const project = ["desktop", "mobile"].includes(item.projectName) ? item.projectName : "other";
        for (const result of Array.isArray(item.results) ? item.results : []) {
          if (!["failed", "timedOut", "interrupted"].includes(result.status)) continue;
          const errors = Array.isArray(result.errors) ? result.errors : [];
          let line = 0;
          let column = 0;
          if (file) {
            for (const error of errors) {
              const loc = error?.location;
              if (loc && knownFile(loc.file, files) === file) {
                line = coord(loc.line);
                column = coord(loc.column);
                if (line) break;
              }
              for (const hit of String(error?.stack ?? "").replaceAll("\\", "/")
                .matchAll(/(?:tests\/e2e\/)?[A-Za-z0-9._/-]+\.spec\.ts:(\d+):(\d+)/g)) {
                const stackFile = hit[0].slice(0, hit[0].lastIndexOf(":" + hit[1] + ":" + hit[2]));
                if (knownFile(stackFile, files) !== file) continue;
                line = coord(Number(hit[1]));
                column = coord(Number(hit[2]));
                break;
              }
              if (line) break;
            }
          }
          failures.push({
            spec: file ? files.indexOf(file) + 1 : 0,
            declaration: coord(spec.line ?? spec.location?.line),
            line, column, project,
            kind: category(errors, result),
            retry: count(result.retry),
          });
        }
      }
    }
    for (const child of Array.isArray(suite.suites) ? suite.suites : []) visit(child, suiteFile);
  }
  for (const suite of report.suites) visit(suite, null);
  return {
    expected: count(report.stats.expected),
    unexpected: count(report.stats.unexpected),
    flaky: count(report.stats.flaky),
    skipped: count(report.stats.skipped),
    failures: failures.slice(0, 40),
    omitted: Math.max(0, failures.length - 40),
  };
}

export function formatE2ESummary(summary) {
  return [
    "D06_E2E_STRUCTURED=PASS",
    "D06_E2E_COUNTS=" + [summary.expected, summary.unexpected, summary.flaky, summary.skipped].join(":"),
    ...summary.failures.map((f) =>
      "D06_E2E_FAILURE=" + [f.spec, f.declaration, f.line, f.column, f.project, f.kind, f.retry].join(":")
    ),
    "D06_E2E_OMITTED=" + summary.omitted,
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const inventory = execFileSync("git", ["ls-files", "-z", "--", "tests/e2e"], {
      encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    }).split("\0");
    const report = JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));
    console.log(formatE2ESummary(summarizeE2E(report, inventory)));
  } catch {
    console.log("D06_E2E_STRUCTURED=FAIL");
    process.exitCode = 1;
  }
}
