#!/usr/bin/env node

import {
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const reportPath = join(
  process.cwd(),
  "artifacts",
  "test-report.json",
);

const report = JSON.parse(
  readFileSync(reportPath, "utf8"),
);

function normalizeTestPath(value) {
  const path = String(value).replaceAll("\\", "/");

  if (path.startsWith("tests/")) {
    return path;
  }

  const marker = "/tests/";
  const index = path.lastIndexOf(marker);

  if (index < 0) {
    throw new Error(
      `Cannot normalize test path: ${value}`,
    );
  }

  return `tests/${path.slice(
    index + marker.length,
  )}`;
}

report.testResults = report.testResults.map(
  (result) => ({
    ...result,
    name: normalizeTestPath(result.name),
  }),
);

writeFileSync(
  reportPath,
  `${JSON.stringify(report, null, 2)}\n`,
);

console.log("test report paths normalized");
