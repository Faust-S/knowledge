#!/usr/bin/env node
// release:prepare:health — assemble release-health/workspace and
// release-health/workspace-health-static.zip from a build produced by
// `npm run build:health` (VITE_ENABLE_HEALTH_PROFILE=true).
//
// Contract mirrors release:prepare but:
//   - reads dist/ (must have been built in health mode),
//   - emits into release-health/,
//   - the ZIP is named workspace-health-static.zip,
//   - the same stripping rules apply (no domain.json, no source maps,
//     no loader placeholder, no mock/kernel code, no tests).
import {
  rmSync, mkdirSync, existsSync, readdirSync, statSync,
  copyFileSync, readFileSync, writeFileSync, unlinkSync,
} from "node:fs";
import { join, relative, dirname } from "node:path";
import { createHash } from "node:crypto";
import { collectDirectoryEntries, writeStoredZip } from "./zip-store.mjs";

const root = process.cwd();
const dist = join(root, "dist");
const releaseDir = join(root, "release-health");
const workspaceDir = join(releaseDir, "workspace");
const zipPath = join(releaseDir, "workspace-health-static.zip");
const sumsPath = join(releaseDir, "SHA256SUMS.txt");

if (!existsSync(dist)) {
  console.error("❌ dist/ missing — run `npm run build:health` first");
  process.exit(1);
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(workspaceDir, { recursive: true });

const copyRecursive = (src, dst) => {
  const s = statSync(src);
  if (s.isDirectory()) {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src)) copyRecursive(join(src, entry), join(dst, entry));
  } else {
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }
};
copyRecursive(dist, workspaceDir);

const STRIP_NAMES = new Set([
  "domain.json",
  "loader.js.placeholder",
  "sw.js",
  "service-worker.js",
  "workbox-sw.js",
  "manifest.webmanifest",
  "manifest.json",
  "vitest.config.js",
  "vitest.config.ts",
  "test-report.json",
]);
const STRIP_DIRS = new Set(["fixtures", "tests", "__tests__", "__mocks__"]);
const STRIP_EXT = /\.map$/;
const STRIP_BASENAME_MATCH = /(^|[/\\])(mock|kernel)[.-].*\.(js|mjs|cjs|ts)$/i;

const stripped = [];
const walkAndStrip = (dir) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (STRIP_DIRS.has(entry)) {
        rmSync(p, { recursive: true, force: true });
        stripped.push(relative(root, p));
        continue;
      }
      walkAndStrip(p);
    } else if (
      STRIP_NAMES.has(entry) ||
      STRIP_EXT.test(entry) ||
      STRIP_BASENAME_MATCH.test(p)
    ) {
      unlinkSync(p);
      stripped.push(relative(root, p));
    }
  }
};
walkAndStrip(workspaceDir);

const pruneEmpty = (dir) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      pruneEmpty(p);
      if (readdirSync(p).length === 0) rmSync(p, { recursive: true });
    }
  }
};
pruneEmpty(workspaceDir);

writeStoredZip(zipPath, collectDirectoryEntries(workspaceDir, "workspace/"));

const files = [];
const collect = (dir) => {
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) collect(p);
    else files.push(p);
  }
};
collect(workspaceDir);
files.push(zipPath);

const lines = files.map((f) => {
  const h = createHash("sha256").update(readFileSync(f)).digest("hex");
  return `${h}  ${relative(releaseDir, f).split("\\").join("/")}`;
});
writeFileSync(sumsPath, lines.join("\n") + "\n");

console.log("✅ release:prepare:health complete");
console.log(`   workspace files: ${files.length - 1}`);
console.log(`   zip: ${relative(root, zipPath)}`);
console.log(`   sums: ${relative(root, sumsPath)}`);
if (stripped.length) {
  console.log(`   stripped ${stripped.length} artefact(s):`);
  for (const s of stripped) console.log(`     - ${s}`);
}
